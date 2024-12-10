import * as os from 'node:os'
import * as path from 'node:path'
import {
    type ChatClient,
    type ContextItem,
    type Message,
    PromptString,
    TokenCounterUtils,
    firstValueFrom,
    getSimplePreamble,
    pendingOperation,
    tracer,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import type { Edge } from '../../webviews/workflow/components/CustomOrderedEdge'
import { getInactiveNodes } from '../../webviews/workflow/components/hooks/nodeStateTransforming'
import {
    type CLINode,
    type LLMNode,
    NodeType,
    type WorkflowNodes,
} from '../../webviews/workflow/components/nodes/Nodes'
import type { WorkflowFromExtension } from '../../webviews/workflow/services/WorkflowProtocol'
import { ChatController, type ChatSession } from '../chat/chat-view/ChatController'
import { type ContextRetriever, toStructuredMentions } from '../chat/chat-view/ContextRetriever'
import { getCorpusContextItemsForEditorState } from '../chat/initialContext'
import { PersistentShell } from '../commands/context/shell'
import { executeChat } from '../commands/execute/ask'

interface IndexedEdges {
    bySource: Map<string, Edge[]>
    byTarget: Map<string, Edge[]>
    byId: Map<string, Edge>
}

interface ExecutionContext {
    nodeOutputs: Map<string, string | string[]>
}

export interface IndexedExecutionContext extends ExecutionContext {
    nodeIndex: Map<string, WorkflowNodes>
    edgeIndex: IndexedEdges
}

/**
 * Executes a workflow with the given nodes, edges, and other dependencies.
 *
 * @param nodes - The workflow nodes to execute.
 * @param edges - The edges between the workflow nodes.
 * @param webview - The VSCode webview to communicate with.
 * @param chatClient - The chat client to use for LLM nodes.
 * @param abortSignal - An AbortSignal to allow cancellation of the workflow execution.
 * @param contextRetriever - A partial ContextRetriever implementation to retrieve context for the workflow.
 * @param approvalHandler - A function to handle approvals for CLI nodes.
 * @returns - A Promise that resolves when the workflow execution is completed.
 */
export async function executeWorkflow(
    nodes: WorkflowNodes[],
    edges: Edge[],
    webview: vscode.Webview,
    chatClient: ChatClient,
    abortSignal: AbortSignal,
    contextRetriever: Pick<ContextRetriever, 'retrieveContext'>,
    approvalHandler: (nodeId: string) => Promise<{ command?: string }>
): Promise<void> {
    const edgeIndex = createEdgeIndex(edges)
    const nodeIndex = new Map(nodes.map(node => [node.id, node]))
    const context: IndexedExecutionContext = {
        nodeOutputs: new Map(),
        nodeIndex,
        edgeIndex,
    }

    // Calculate all inactive nodes
    const allInactiveNodes = new Set<string>()
    for (const node of nodes) {
        if (node.data.active === false) {
            const dependentInactiveNodes = getInactiveNodes(edges, node.id)
            for (const id of dependentInactiveNodes) {
                allInactiveNodes.add(id)
            }
        }
    }

    const sortedNodes = topologicalSort(nodes, edges)
    const persistentShell = new PersistentShell()

    webview.postMessage({
        type: 'execution_started',
    } as WorkflowFromExtension)

    for (const node of sortedNodes) {
        if (allInactiveNodes.has(node.id)) {
            continue
        }

        webview.postMessage({
            type: 'node_execution_status',
            data: { nodeId: node.id, status: 'running' },
        } as WorkflowFromExtension)

        let result: string | string[]
        switch (node.type) {
            case NodeType.CLI: {
                try {
                    const inputs = combineParentOutputsByConnectionOrder(
                        node.id,

                        context
                    ).map(output => sanitizeForShell(output))
                    const command = (node as CLINode).data.content
                        ? replaceIndexedInputs((node as CLINode).data.content, inputs)
                        : ''
                    result = await executeCLINode(
                        { ...(node as CLINode), data: { ...(node as CLINode).data, content: command } },
                        abortSignal,
                        persistentShell,
                        webview,
                        approvalHandler
                    )
                } catch (error: unknown) {
                    persistentShell.dispose()
                    const errorMessage = error instanceof Error ? error.message : String(error)
                    const status = errorMessage.includes('aborted') ? 'interrupted' : 'error'

                    void vscode.window.showErrorMessage(`CLI Node Error: ${errorMessage}`)

                    webview.postMessage({
                        type: 'node_execution_status',
                        data: { nodeId: node.id, status, result: errorMessage },
                    } as WorkflowFromExtension)

                    webview.postMessage({
                        type: 'execution_completed',
                    } as WorkflowFromExtension)

                    return
                }
                break
            }
            case NodeType.LLM: {
                const inputs = combineParentOutputsByConnectionOrder(
                    node.id,

                    context
                ).map(input => sanitizeForPrompt(input))
                const prompt = node.data.content ? replaceIndexedInputs(node.data.content, inputs) : ''
                result = await executeLLMNode(
                    { ...node, data: { ...node.data, content: prompt } },
                    chatClient,
                    abortSignal
                )
                break
            }
            case NodeType.PREVIEW: {
                const inputs = combineParentOutputsByConnectionOrder(node.id, context)
                result = await executePreviewNode(inputs.join('\n'), node.id, webview)
                break
            }

            case NodeType.INPUT: {
                const inputs = combineParentOutputsByConnectionOrder(node.id, context)
                const text = node.data.content ? replaceIndexedInputs(node.data.content, inputs) : ''
                result = await executeInputNode(text)
                break
            }

            case NodeType.SEARCH_CONTEXT: {
                const inputs = combineParentOutputsByConnectionOrder(node.id, context)
                const text = node.data.content ? replaceIndexedInputs(node.data.content, inputs) : ''
                result = await executeSearchContextNode(text, contextRetriever)
                break
            }
            case NodeType.CODY_OUTPUT: {
                try {
                    const parentEdges = context.edgeIndex.byTarget.get(node.id) || []
                    const nonSearchContextEdges = parentEdges.filter(edge => {
                        const sourceNode = context.nodeIndex.get(edge.source)
                        return sourceNode?.type !== NodeType.SEARCH_CONTEXT
                    })
                    const inputs = combineParentOutputsByConnectionOrder(node.id, {
                        ...context,
                        edgeIndex: {
                            ...context.edgeIndex,
                            byTarget: new Map([[node.id, nonSearchContextEdges]]),
                        },
                    })

                    const parentNodesByParentEdges = parentEdges.map(edge =>
                        context.nodeIndex.get(edge.source)
                    )
                    const searchContextNode = parentNodesByParentEdges.find(
                        node => node?.type === NodeType.SEARCH_CONTEXT
                    )
                    const contextItems = context.nodeOutputs.get(searchContextNode?.id || '') as
                        | string[]
                        | undefined
                    result = await executeCodyOutputNode(inputs.join('\n'), contextItems, abortSignal)
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error)
                    const status = errorMessage.includes('aborted') ? 'interrupted' : 'error'

                    webview.postMessage({
                        type: 'node_execution_status',
                        data: { nodeId: node.id, status, result: errorMessage },
                    } as WorkflowFromExtension)

                    webview.postMessage({
                        type: 'execution_completed',
                    } as WorkflowFromExtension)

                    return
                }
                break
            }
            default:
                persistentShell.dispose()
                throw new Error(`Unknown node type: ${(node as WorkflowNodes).type}`)
        }

        context.nodeOutputs.set(node.id, result)
        webview.postMessage({
            type: 'node_execution_status',
            data: { nodeId: node.id, status: 'completed', result },
        } as WorkflowFromExtension)
    }

    persistentShell.dispose()
    webview.postMessage({
        type: 'execution_completed',
    } as WorkflowFromExtension)
}

/**
 * Creates an index of edges for efficient lookups.
 *
 * The returned `IndexedEdges` object contains three maps:
 * - `bySource`: A map of source node IDs to arrays of edges originating from that node.
 * - `byTarget`: A map of target node IDs to arrays of edges targeting that node.
 * - `byId`: A map of edge IDs to the corresponding edge objects.
 *
 * This index can be used to quickly find all edges related to a given node, either by source or target.
 *
 * @param edges - The list of edges to index.
 * @returns The indexed edges.
 */
export function createEdgeIndex(edges: Edge[]): IndexedEdges {
    const bySource = new Map<string, Edge[]>()
    const byTarget = new Map<string, Edge[]>()
    const byId = new Map<string, Edge>()

    for (const edge of edges) {
        // Index by source
        const sourceEdges = bySource.get(edge.source) || []
        sourceEdges.push(edge)
        bySource.set(edge.source, sourceEdges)

        // Index by target
        const targetEdges = byTarget.get(edge.target) || []
        targetEdges.push(edge)
        byTarget.set(edge.target, targetEdges)

        // Index by id
        byId.set(edge.id, edge)
    }

    return { bySource, byTarget, byId }
}

/**
 * Performs a topological sort on a set of workflow nodes and edges, returning the nodes in the sorted order.
 *
 * @param nodes - An array of workflow nodes.
 * @param edges - An array of edges connecting the workflow nodes.
 * @returns The workflow nodes in topologically sorted order.
 */
export function topologicalSort(nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes[] {
    const edgeIndex = createEdgeIndex(edges)
    const nodeIndex = new Map(nodes.map(node => [node.id, node]))
    const inDegree = new Map<string, number>()

    // Initialize inDegree using indexed lookups
    for (const node of nodes) {
        inDegree.set(node.id, edgeIndex.byTarget.get(node.id)?.length || 0)
    }

    const sourceNodes = nodes.filter(node => inDegree.get(node.id) === 0)
    const queue = sourceNodes.map(node => node.id)
    const result: string[] = []

    while (queue.length > 0) {
        const nodeId = queue.shift()!
        result.push(nodeId)

        const outgoingEdges = edgeIndex.bySource.get(nodeId) || []
        for (const edge of outgoingEdges) {
            const targetInDegree = inDegree.get(edge.target)! - 1
            inDegree.set(edge.target, targetInDegree)
            if (targetInDegree === 0) {
                queue.push(edge.target)
            }
        }
    }

    return result.map(id => nodeIndex.get(id)!).filter(Boolean)
}

/**
 * Replaces indexed placeholders in a template string with the corresponding values from the parentOutputs array.
 *
 * @param template - The template string containing indexed placeholders.
 * @param parentOutputs - The array of parent output values to substitute into the template.
 * @returns The template string with the indexed placeholders replaced.
 */
export function replaceIndexedInputs(template: string, parentOutputs: string[]): string {
    return template.replace(/\${(\d+)}/g, (_match, index) => {
        const adjustedIndex = Number.parseInt(index, 10) - 1
        return adjustedIndex >= 0 && adjustedIndex < parentOutputs.length
            ? parentOutputs[adjustedIndex]
            : ''
    })
}

/**
 * Combines the output values of the parent nodes connected to the specified nodeId, preserving the order of the connections.
 *
 * @param nodeId - The ID of the node whose parent outputs should be combined.
 * @param context - The IndexedExecutionContext containing the necessary information to combine the parent outputs.
 * @returns An array of strings representing the combined parent outputs.
 */
export function combineParentOutputsByConnectionOrder(
    nodeId: string,
    context: IndexedExecutionContext
): string[] {
    const parentEdges = context.edgeIndex.byTarget.get(nodeId) || []

    return parentEdges
        .map(edge => {
            let output = context.nodeOutputs.get(edge.source)
            if (Array.isArray(output)) {
                output = output.join('\n')
            }

            if (output === undefined) {
                return ''
            }
            // Normalize line endings and collapse multiple newlines
            return output.replace(/\r\n/g, '\n').trim()
        })
        .filter(output => output !== undefined)
}

/**
 * Executes a CLI node in a workflow, handling user approval, command filtering, and error handling.
 *
 * @param node - The workflow node to execute.
 * @param abortSignal - An AbortSignal that can be used to cancel the execution.
 * @param persistentShell - A PersistentShell instance to execute the command.
 * @param webview - A VSCode Webview instance to report the execution status.
 * @param approvalHandler - A function that handles user approval for the command.
 * @returns The result of executing the CLI command.
 * @throws {Error} If the shell command is not supported, the command is empty, the command is not allowed, or there is an error executing the command.
 */
export async function executeCLINode(
    node: WorkflowNodes,
    abortSignal: AbortSignal,
    persistentShell: PersistentShell,
    webview: vscode.Webview,
    approvalHandler: (nodeId: string) => Promise<{ command?: string }>
): Promise<string> {
    if (!vscode.env.shell || !vscode.workspace.isTrusted) {
        throw new Error('Shell command is not supported in your current workspace.')
    }
    // Add validation for empty commands
    if (!node.data.content?.trim()) {
        throw new Error('CLI Node requires a non-empty command')
    }

    const homeDir = os.homedir() || process.env.HOME || process.env.USERPROFILE || ''

    const filteredCommand =
        (node as CLINode).data.content?.replaceAll(/(\s~\/)/g, ` ${homeDir}${path.sep}`) || ''

    // Replace double quotes with single quotes, preserving any existing escaped quotes
    const convertQuotes = filteredCommand.replace(/(?<!\\)"/g, "'")

    let commandToExecute = convertQuotes

    if (node.data.needsUserApproval) {
        webview.postMessage({
            type: 'node_execution_status',
            data: {
                nodeId: node.id,
                status: 'pending_approval',
                result: `${commandToExecute}`,
            },
        } as WorkflowFromExtension)

        const approval = await approvalHandler(node.id)
        if (approval.command) {
            commandToExecute = approval.command
        }
    }

    if (commandsNotAllowed.some(cmd => convertQuotes.startsWith(cmd))) {
        void vscode.window.showErrorMessage('Cody cannot execute this command')
        throw new Error('Cody cannot execute this command')
    }

    try {
        const result = await persistentShell.execute(commandToExecute, abortSignal)
        return result
    } catch (error: unknown) {
        persistentShell.dispose()
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`CLI Node execution failed: ${errorMessage}`) // Re-throw for handling in executeWorkflow
    }
}

/**
 * Executes an LLM (Large Language Model) node in a workflow.
 *
 * This function handles the execution of an LLM node, which involves setting up the necessary messages,
 * initiating the chat with the configured options, and handling the response stream. It also includes
 * a timeout mechanism to prevent the request from hanging indefinitely.
 *
 * @param {WorkflowNodes} node - The workflow node being executed, which contains the necessary data for the LLM request.
 * @param {ChatClient} chatClient - A ChatClient instance used to interact with the LLM service.
 * @param {AbortSignal} [abortSignal] - An optional AbortSignal that can be used to cancel the LLM request.
 * @returns {Promise<string>} A Promise that resolves to the final response from the LLM service.
 */

async function executeLLMNode(
    node: WorkflowNodes,
    chatClient: ChatClient,
    abortSignal?: AbortSignal
): Promise<string> {
    if (!node.data.content) {
        throw new Error(`No prompt specified for LLM node ${node.id} with ${node.data.title}`)
    }

    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('LLM request timed out')), 30000)
    })

    try {
        const preamble = getSimplePreamble(
            'anthropic::2024-10-22::claude-3-5-sonnet-latest',
            1,
            'Default'
        )
        const messages: Message[] = [
            ...preamble,
            {
                speaker: 'human',
                text: PromptString.unsafe_fromUserQuery(node.data.content),
            },
        ]

        const streamPromise = new Promise<string>((resolve, reject) => {
            // Use the AsyncGenerator correctly
            chatClient
                .chat(
                    messages,
                    {
                        stream: false,
                        maxTokensToSample: (node as LLMNode).data.maxTokens ?? 1000,
                        fast: (node as LLMNode).data.fast ?? true,
                        model: 'anthropic::2024-10-22::claude-3-5-sonnet-latest',
                        temperature: (node as LLMNode).data.temperature ?? 0,
                    },
                    abortSignal
                )
                .then(async stream => {
                    const responseBuilder: string[] = []
                    try {
                        for await (const message of stream) {
                            switch (message.type) {
                                case 'change':
                                    if (responseBuilder.join('').length > 1_000_000) {
                                        reject(new Error('Response too large'))
                                        return
                                    }
                                    responseBuilder.push(message.text)
                                    break
                                case 'complete':
                                    resolve(responseBuilder.join(''))
                                    break
                                case 'error':
                                    reject(message.error)
                                    break
                            }
                        }
                    } catch (error) {
                        reject(error)
                    }
                })
                .catch(reject)
        })

        return await Promise.race([streamPromise, timeout])
    } catch (error) {
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                throw new Error('Workflow execution aborted')
            }
            throw new Error(`Failed to execute LLM node: ${error.message}`)
        }
        throw new Error('Unknown error in LLM node execution')
    }
}

/**
 * Executes a preview node in the workflow, trimming the input and sending the token count to the webview.
 *
 * @param input - The input string to be processed.
 * @param nodeId - The ID of the node being executed.
 * @param webview - The VSCode webview instance to send the token count to.
 * @returns The trimmed input string.
 */
async function executePreviewNode(
    input: string,
    nodeId: string,
    webview: vscode.Webview
): Promise<string> {
    const trimmedInput = input.trim()
    const tokenCount = await TokenCounterUtils.encode(trimmedInput)

    webview.postMessage({
        type: 'token_count',
        data: {
            nodeId,
            count: tokenCount.length,
        },
    } as WorkflowFromExtension)

    return trimmedInput
}

/**
 * Executes an input node in the workflow, trimming the input string.
 *
 * @param input - The input string to be processed.
 * @returns The trimmed input string.
 */
async function executeInputNode(input: string): Promise<string> {
    return input.trim()
}

/**
 * Executes a search context node in the workflow, retrieving and formatting relevant context items based on the input.
 *
 * @param input - The input string to be used for retrieving the context.
 * @param contextRetriever - An object with a `retrieveContext` method that can be used to retrieve the context.
 * @returns An array of strings, where each string represents a formatted context item (path + newline + content).
 */
async function executeSearchContextNode(
    input: string,
    contextRetriever: Pick<ContextRetriever, 'retrieveContext'>
): Promise<string[]> {
    const corpusItems = await firstValueFrom(getCorpusContextItemsForEditorState())
    if (corpusItems === pendingOperation || corpusItems.length === 0) {
        return ['']
    }
    const repo = corpusItems.find(i => i.type === 'tree' || i.type === 'repository')
    if (!repo) {
        return ['']
    }
    const span = tracer.startSpan('chat.submit')
    const context = await contextRetriever.retrieveContext(
        toStructuredMentions([repo]),
        PromptString.unsafe_fromLLMResponse(input),
        span,
        undefined,
        false
    )
    span.end()
    const result = context.map(item => {
        // Format each context item as path + newline + content
        return `${item.uri.path}\n${item.content || ''}`
    })
    //.join('\n\n') // Join multiple items with double newlines

    return result
}

/**
 * Executes an output node in the workflow, which involves continuing a chat session and waiting for new messages.
 *
 * @param input - The input string to be used for the chat.
 * @param contextItemsAsString - An optional array of strings representing the context items to be used for the chat.
 * @param abortSignal - An AbortSignal that can be used to cancel the workflow execution.
 * @returns A Promise that resolves with the session ID of the completed chat session.
 */
async function executeCodyOutputNode(
    input: string,
    contextItemsAsString: string[] | undefined,
    abortSignal: AbortSignal
): Promise<string> {
    const stringToContext = contextItemsAsString ? stringToContextItems(contextItemsAsString) : []

    return new Promise<string>((resolve, reject) => {
        // Handle workflow abortion
        abortSignal.addEventListener('abort', () => {
            reject(new Error('Workflow execution aborted'))
        })

        executeChat({
            text: PromptString.unsafe_fromLLMResponse(input),
            contextItems: stringToContext,
            submitType: 'continue-chat',
        }).then((value: ChatSession | ChatController | undefined) => {
            if (value instanceof ChatController) {
                const messages = value.getViewTranscript()
                const initialMessageCount = messages.length
                // Check for new messages periodically
                const interval = setInterval(() => {
                    if (abortSignal.aborted) {
                        clearInterval(interval)
                        value.startNewSubmitOrEditOperation() // This aborts any ongoing chat
                        reject(new Error('Workflow execution aborted'))
                        return
                    }
                    const currentMessages = value.getViewTranscript()
                    if (currentMessages.length > initialMessageCount) {
                        clearInterval(interval)
                        resolve(value.sessionID)
                    }
                }, 100)
            } else {
                resolve('')
            }
        })
    })
}

/**
 * Converts an array of strings representing context items into an array of `ContextItem` objects.
 * Each string in the input array is expected to be in the format `"<file path>\n<file content>"`.
 * The function extracts the file path and content, and creates a `ContextItem` object with the appropriate properties.
 *
 * @param input - An array of strings representing context items.
 * @returns An array of `ContextItem` objects.
 */
function stringToContextItems(input: string[]): ContextItem[] {
    //const lines = input.split('\n')
    const contextItems: ContextItem[] = input.map(line => {
        const [firstLine, ...rest] = line.split('\n')
        return {
            type: 'file',
            content: rest.join('\n'),
            uri: vscode.Uri.file(firstLine),
        }
    })
    return contextItems
}

/**
 * Sanitizes a given input string by escaping backslashes and ${} template syntax.
 *
 * This function is used to sanitize user input before using it in shell commands or similar contexts,
 * in order to prevent potential security issues like command injection.
 *
 * @param input - The input string to be sanitized.
 * @returns The sanitized string with backslashes and ${} escaped.
 */
export function sanitizeForShell(input: string): string {
    // Only escape backslashes and ${} template syntax
    return input.replace(/\\/g, '\\\\').replace(/\${/g, '\\${')
}

/**
 * Sanitizes a given input string by escaping ${} template syntax.
 *
 * This function is used to sanitize user input before using it in contexts where template syntax
 * could cause security issues like command injection.
 *
 * @param input - The input string to be sanitized.
 * @returns The sanitized string with ${} escaped.
 */
function sanitizeForPrompt(input: string): string {
    return input.replace(/\${/g, '\\${')
}

const commandsNotAllowed = [
    'rm',
    'chmod',
    'shutdown',
    'history',
    'user',
    'sudo',
    'su',
    'passwd',
    'chown',
    'chgrp',
    'kill',
    'reboot',
    'poweroff',
    'init',
    'systemctl',
    'journalctl',
    'dmesg',
    'lsblk',
    'lsmod',
    'modprobe',
    'insmod',
    'rmmod',
    'lsusb',
    'lspci',
]
