import * as os from 'node:os'
import * as path from 'node:path'
import {
    type ChatClient,
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
import { getInactiveNodes } from '../../webviews/workflow/components/Flow'
import type { WorkflowNode } from '../../webviews/workflow/components/nodes/Nodes'
import type { WorkflowFromExtension } from '../../webviews/workflow/services/WorkflowProtocol'
import { type ContextRetriever, toStructuredMentions } from '../chat/chat-view/ContextRetriever'
import { getCorpusContextItemsForEditorState } from '../chat/initialContext'
import { PersistentShell } from '../commands/context/shell'

interface IndexedEdges {
    bySource: Map<string, Edge[]>
    byTarget: Map<string, Edge[]>
    byId: Map<string, Edge>
}

interface ExecutionContext {
    nodeOutputs: Map<string, string>
}

interface IndexedExecutionContext extends ExecutionContext {
    nodeIndex: Map<string, WorkflowNode>
    edgeIndex: IndexedEdges
}

function createEdgeIndex(edges: Edge[]): IndexedEdges {
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
 * Performs a topological sort on the given workflow nodes and edges, returning the sorted nodes.
 *
 * @param nodes - The workflow nodes to sort.
 * @param edges - The edges between the workflow nodes.
 * @returns The sorted workflow nodes.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
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
 * Executes a CLI node in a workflow, running the specified shell command and returning its output.
 *
 * @param node - The workflow node to execute.
 * @param abortSignal - The abort signal to cancel the execution.
 * @returns The output of the shell command.
 * @throws {Error} If the shell is not available, the workspace is not trusted, or the command fails to execute.
 */
async function executeCLINode(
    node: WorkflowNode,
    abortSignal: AbortSignal,
    persistentShell: PersistentShell
): Promise<string> {
    if (!vscode.env.shell || !vscode.workspace.isTrusted) {
        throw new Error('Shell command is not supported in your current workspace.')
    }

    const homeDir = os.homedir() || process.env.HOME || process.env.USERPROFILE || ''

    const filteredCommand = node.data.command?.replaceAll(/(\s~\/)/g, ` ${homeDir}${path.sep}`) || ''

    if (commandsNotAllowed.some(cmd => filteredCommand.startsWith(cmd))) {
        void vscode.window.showErrorMessage('Cody cannot execute this command')
        throw new Error('Cody cannot execute this command')
    }

    try {
        return await persistentShell.execute(filteredCommand, abortSignal)
    } catch (error: unknown) {
        persistentShell.dispose()
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`CLI Node execution failed: ${errorMessage}`) // Re-throw for handling in executeWorkflow
    }
}

/**
 * Executes Cody AI node in a workflow, using the provided chat client to generate a response based on the specified prompt.
 *
 * @param node - The workflow node to execute.
 * @param chatClient - The chat client to use for generating the LLM response.
 * @returns The generated response from the LLM.
 * @throws {Error} If no prompt is specified for the LLM node, or if there is an error executing the LLM node.
 */
async function executeLLMNode(
    node: WorkflowNode,
    chatClient: ChatClient,
    abortSignal?: AbortSignal
): Promise<string> {
    if (!node.data.prompt) {
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
                text: PromptString.unsafe_fromUserQuery(node.data.prompt),
            },
        ]

        const streamPromise = new Promise<string>((resolve, reject) => {
            // Use the AsyncGenerator correctly
            chatClient
                .chat(
                    messages,
                    {
                        stream: false,
                        maxTokensToSample: node.data.maxTokens ?? 1000,
                        fast: node.data.fast ?? true,
                        model: 'anthropic::2024-10-22::claude-3-5-sonnet-latest',
                        temperature: node.data.temperature ?? 0,
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

async function executeInputNode(input: string): Promise<string> {
    return input.trim()
}

async function executeSearchContextNode(
    input: string,
    contextRetriever: Pick<ContextRetriever, 'retrieveContext'>
): Promise<string> {
    const corpusItems = await firstValueFrom(getCorpusContextItemsForEditorState())
    if (corpusItems === pendingOperation || corpusItems.length === 0) {
        return ''
    }
    const repo = corpusItems.find(i => i.type === 'tree' || i.type === 'repository')
    if (!repo) {
        return ''
    }
    const span = tracer.startSpan('chat.submit')
    const context = await contextRetriever.retrieveContext(
        toStructuredMentions([repo]),
        PromptString.unsafe_fromLLMResponse(input),
        span,
        undefined,
        true
    )
    span.end()
    const result = context
        .map(item => {
            // Format each context item as path + newline + content
            return `${item.uri.path}\n${item.content || ''}`
        })
        .join('\n\n') // Join multiple items with double newlines

    return result
}

/**
 * Replaces indexed placeholders in a template string with the corresponding values from the parentOutputs array.
 *
 * @param template - The template string containing indexed placeholders.
 * @param parentOutputs - The array of parent output values to substitute into the template.
 * @returns The template string with the indexed placeholders replaced.
 */
function replaceIndexedInputs(template: string, parentOutputs: string[]): string {
    return template.replace(/\${(\d+)}/g, (_match, index) => {
        const adjustedIndex = Number.parseInt(index, 10) - 1
        return adjustedIndex >= 0 && adjustedIndex < parentOutputs.length
            ? parentOutputs[adjustedIndex]
            : ''
    })
}

/**
 * Combines the outputs from parent nodes in a workflow, with optional sanitization for different node types.
 *
 * @param nodeId - The ID of the current node.
 * @param edges - The edges (connections) in the workflow.
 * @param context - The execution context, including the stored node outputs.
 * @param nodeType - The type of the current node (e.g. 'cli' or 'llm').
 * @returns An array of the combined parent outputs, with optional sanitization.
 */
function combineParentOutputsByConnectionOrder(
    nodeId: string,
    edges: Edge[],
    context: IndexedExecutionContext,
    nodeType: string
): string[] {
    const parentEdges = context.edgeIndex.byTarget.get(nodeId) || []
    return parentEdges
        .map(edge => {
            const output = context.nodeOutputs.get(edge.source)
            if (output === undefined) {
                return ''
            }
            // Normalize line endings and collapse multiple newlines
            return output.replace(/\r\n/g, '\n').trim()
        })
        .filter(output => output !== undefined)
}

/**
 * Executes a workflow by running each node in the workflow and combining the outputs from parent nodes.
 *
 * @param nodes - The workflow nodes to execute.
 * @param edges - The connections between the workflow nodes.
 * @param webview - The VSCode webview instance to send status updates to.
 * @param chatClient - The chat client to use for executing LLM nodes.
 * @returns A Promise that resolves when the workflow execution is complete.
 */
export async function executeWorkflow(
    nodes: WorkflowNode[],
    edges: Edge[],
    webview: vscode.Webview,
    chatClient: ChatClient,
    abortController: AbortSignal,
    contextRetriever: Pick<ContextRetriever, 'retrieveContext'>
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

        let result: string
        switch (node.type) {
            case 'cli': {
                try {
                    const inputs = combineParentOutputsByConnectionOrder(
                        node.id,
                        edges,
                        context,
                        node.type
                    ).map(output => sanitizeForShell(output))
                    const command = node.data.command
                        ? replaceIndexedInputs(node.data.command, inputs)
                        : ''
                    result = await executeCLINode(
                        { ...node, data: { ...node.data, command } },
                        abortController,
                        persistentShell
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
            case 'llm': {
                const inputs = combineParentOutputsByConnectionOrder(
                    node.id,
                    edges,
                    context,
                    node.type
                ).map(input => sanitizeForPrompt(input))
                const prompt = node.data.prompt ? replaceIndexedInputs(node.data.prompt, inputs) : ''
                result = await executeLLMNode(
                    { ...node, data: { ...node.data, prompt } },
                    chatClient,
                    abortController
                )
                break
            }
            case 'preview': {
                const inputs = combineParentOutputsByConnectionOrder(node.id, edges, context, node.type)
                result = await executePreviewNode(inputs.join('\n'), node.id, webview)
                break
            }

            case 'text-format': {
                const inputs = combineParentOutputsByConnectionOrder(node.id, edges, context, node.type)
                const text = node.data.content ? replaceIndexedInputs(node.data.content, inputs) : ''
                result = await executeInputNode(text)
                break
            }

            case 'search-context': {
                const inputs = combineParentOutputsByConnectionOrder(node.id, edges, context, node.type)
                result = await executeSearchContextNode(inputs.join('\n'), contextRetriever)
                break
            }
            default:
                persistentShell.dispose()
                throw new Error(`Unknown node type: ${node.type}`)
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

function sanitizeForShell(input: string): string {
    // Escape special characters but preserve actual newlines
    return input.replace(/(["\\'$`])/g, '\\$1') //.replace(/\r\n/g, '\n') // Normalize CRLF to LF
}

function sanitizeForPrompt(input: string): string {
    return input.replace(/\${/g, '\\${')
}

/* function getInactiveNodes(nodes: WorkflowNode[], edges: Edge[], startNodeId: string): Set<string> {
    const inactiveNodes = new Set<string>()
    const queue = [startNodeId]

    while (queue.length > 0) {
        const currentId = queue.shift()!
        inactiveNodes.add(currentId)

        // Find all nodes that depend on the current node
        for (const edge of edges) {
            if (edge.source === currentId && !inactiveNodes.has(edge.target)) {
                queue.push(edge.target)
            }
        }
    }

    return inactiveNodes
} */

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
