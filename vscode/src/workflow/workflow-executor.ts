import * as os from 'node:os'
import * as path from 'node:path'
import type { LLMNode } from '@/workflow/components/nodes/LLM_Node'
import type { LoopStartNode } from '@/workflow/components/nodes/LoopStart_Node'
import type { SearchContextNode } from '@/workflow/components/nodes/SearchContext_Node'
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
import type { AccumulatorNode } from '../../webviews/workflow/components/nodes/Accumulator_Node'
import type { IfElseNode } from '../../webviews/workflow/components/nodes/IfElse_Node'
import {
    NodeType,
    type WorkflowNode,
    type WorkflowNodes,
} from '../../webviews/workflow/components/nodes/Nodes'
import type { VariableNode } from '../../webviews/workflow/components/nodes/Variable_Node'
import type { ExtensionToWorkflow } from '../../webviews/workflow/services/WorkflowProtocol'
import { ChatController, type ChatSession } from '../chat/chat-view/ChatController'
import { type ContextRetriever, toStructuredMentions } from '../chat/chat-view/ContextRetriever'
import { getCorpusContextItemsForEditorState } from '../chat/initialContext'
import { PersistentShell } from '../commands/context/shell'
import { executeChat } from '../commands/execute/ask'
import { processGraphComposition } from './node-sorting'
import { StringBuilder } from './utils'

interface IndexedEdges {
    bySource: Map<string, Edge[]>
    byTarget: Map<string, Edge[]>
    byId: Map<string, Edge>
}

export interface IndexedExecutionContext {
    nodeOutputs: Map<string, string | string[]>
    nodeIndex: Map<string, WorkflowNodes>
    edgeIndex: IndexedEdges
    loopStates: Map<
        string,
        {
            currentIteration: number
            maxIterations: number
            variable: string
        }
    >
    accumulatorValues?: Map<string, string>
    cliMetadata?: Map<
        string,
        {
            exitCode: string
        }
    >
    variableValues?: Map<string, string>
    ifelseSkipPaths?: Map<string, Set<string>>
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
        loopStates: new Map(),
        accumulatorValues: new Map(),
        cliMetadata: new Map(),
        variableValues: new Map(),
        ifelseSkipPaths: new Map(),
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
    const sortedNodes = processGraphComposition(nodes, edges, true)
    const persistentShell = new PersistentShell()

    await webview.postMessage({
        type: 'execution_started',
    } as ExtensionToWorkflow)

    for (const node of sortedNodes) {
        const shouldSkip = Array.from(context.ifelseSkipPaths?.values() ?? []).some(skipNodes =>
            skipNodes.has(node.id)
        )

        if (shouldSkip) {
            continue
        }

        if (allInactiveNodes.has(node.id)) {
            continue
        }

        await webview.postMessage({
            type: 'node_execution_status',
            data: { nodeId: node.id, status: 'running' },
        } as ExtensionToWorkflow)

        let result: string | string[]
        try {
            switch (node.type) {
                case NodeType.CLI: {
                    try {
                        result = await executeCLINode(
                            node,
                            abortSignal,
                            persistentShell,
                            webview,
                            approvalHandler,
                            context
                        )
                    } catch (error: unknown) {
                        persistentShell.dispose()
                        const errorMessage = error instanceof Error ? error.message : String(error)
                        const status = errorMessage.includes('aborted') ? 'interrupted' : 'error'

                        void vscode.window.showErrorMessage(`CLI Node Error: ${errorMessage}`)

                        await webview.postMessage({
                            type: 'node_execution_status',
                            data: { nodeId: node.id, status, result: errorMessage },
                        } as ExtensionToWorkflow)

                        await webview.postMessage({
                            type: 'execution_completed',
                        } as ExtensionToWorkflow)
                        return
                    }
                    break
                }
                case NodeType.LLM: {
                    try {
                        result = await executeLLMNode(node, chatClient, abortSignal, context)
                    } catch (error) {
                        console.error('Error in LLM Node:', error)
                        throw error
                    }
                    break
                }
                case NodeType.PREVIEW: {
                    result = await executePreviewNode(node.id, webview, context)
                    break
                }

                case NodeType.INPUT: {
                    result = await executeInputNode(node, context)
                    break
                }

                case NodeType.SEARCH_CONTEXT: {
                    result = await executeSearchContextNode(node, contextRetriever, abortSignal, context)
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
                        // context.nodeOutputs.get(searchContextNode?.id || '') is string[] | undefined
                        let contextItems = context.nodeOutputs.get(searchContextNode?.id || '') // removed cast here
                        if (typeof contextItems === 'string') {
                            // check if contextItems is a string
                            contextItems = contextItems.split('\n----\n') // split string to string array
                        }
                        result = await executeCodyOutputNode(
                            inputs.join('\n'),
                            contextItems,
                            abortSignal
                        )
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error)
                        const status = errorMessage.includes('aborted') ? 'interrupted' : 'error'

                        await webview.postMessage({
                            type: 'node_execution_status',
                            data: { nodeId: node.id, status, result: errorMessage },
                        } as ExtensionToWorkflow)

                        await webview.postMessage({
                            type: 'execution_completed',
                        } as ExtensionToWorkflow)

                        return
                    }
                    break
                }
                case NodeType.LOOP_START: {
                    result = await executeLoopStartNode(node as LoopStartNode, context)
                    break
                }
                case NodeType.LOOP_END: {
                    result = await executePreviewNode(node.id, webview, context)
                    break
                }

                case NodeType.ACCUMULATOR: {
                    const inputs = combineParentOutputsByConnectionOrder(node.id, context)
                    const inputValue = node.data.content
                        ? replaceIndexedInputs(node.data.content, inputs, context)
                        : ''
                    const {
                        data: { variableName, initialValue },
                    } = node as AccumulatorNode
                    let accumulatedValue =
                        context.accumulatorValues?.get(variableName) || initialValue || ''
                    // Accumulation Logic (Initially, just concatenation - enhance later)
                    accumulatedValue += '\n' + inputValue
                    context.accumulatorValues?.set(variableName, accumulatedValue)

                    result = accumulatedValue
                    break
                }

                case NodeType.IF_ELSE: {
                    result = await executeIfElseNode(context, node)
                    break
                }
                case NodeType.VARIABLE: {
                    const inputs = combineParentOutputsByConnectionOrder(node.id, context)
                    const inputValue = node.data.content
                        ? replaceIndexedInputs(node.data.content, inputs, context)
                        : ''
                    const {
                        data: { variableName, initialValue },
                    } = node as VariableNode
                    let variableValue = context.variableValues?.get(variableName) || initialValue || ''
                    variableValue = inputValue
                    context.variableValues?.set(variableName, variableValue)

                    result = variableValue
                    break
                }

                default:
                    persistentShell.dispose()
                    throw new Error(`Unknown node type: ${(node as WorkflowNodes).type}`)
            }
        } catch (error: unknown) {
            if (abortSignal.aborted) {
                persistentShell.dispose()
                await webview.postMessage({
                    type: 'node_execution_status',
                    data: { nodeId: node.id, status: 'interrupted' },
                } as ExtensionToWorkflow)
                return
            }
            const errorMessage = error instanceof Error ? error.message : String(error)
            const status = errorMessage.includes('aborted') ? 'interrupted' : 'error'
            void vscode.window.showErrorMessage(`Node Error: ${errorMessage}`)
            await webview.postMessage({
                type: 'node_execution_status',
                data: { nodeId: node.id, status, result: errorMessage },
            } as ExtensionToWorkflow)

            await webview.postMessage({
                type: 'execution_completed',
            } as ExtensionToWorkflow)
            return
        }

        context.nodeOutputs.set(node.id, result)
        await webview.postMessage({
            type: 'node_execution_status',
            data: { nodeId: node.id, status: 'completed', result },
        } as ExtensionToWorkflow)
    }

    persistentShell.dispose()
    webview.postMessage({
        type: 'execution_completed',
    } as ExtensionToWorkflow)

    context.loopStates.clear()
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
 * Replaces indexed placeholders in a template string with the corresponding values from the parentOutputs array.
 *
 * @param template - The template string containing indexed placeholders.
 * @param parentOutputs - The array of parent output values to substitute into the template.
 * @returns The template string with the indexed placeholders replaced.
 */
export function replaceIndexedInputs(
    template: string,
    parentOutputs: string[],
    context?: IndexedExecutionContext
): string {
    // Only replace numbered placeholders that match exactly ${1}, ${2}, etc.
    let result = template.replace(/\${(\d+)}(?!\w)/g, (_match, index) => {
        const adjustedIndex = Number.parseInt(index, 10) - 1
        return adjustedIndex >= 0 && adjustedIndex < parentOutputs.length
            ? parentOutputs[adjustedIndex]
            : ''
    })

    if (context) {
        // Only replace loop variables that are explicitly defined in the context
        for (const [, loopState] of context.loopStates) {
            result = result.replace(
                new RegExp(`\\$\{${loopState.variable}}(?!\\w)`, 'g'),
                String(loopState.currentIteration)
            )
        }

        // Only replace accumulator variables that are explicitly defined
        const accumulatorVars = context.accumulatorValues
            ? Array.from(context.accumulatorValues.keys())
            : []
        for (const varName of accumulatorVars) {
            result = result.replace(
                new RegExp(`\\$\{${varName}}(?!\\w)`, 'g'),
                context.accumulatorValues?.get(varName) || ''
            )
        }

        // Only replace variable variables that are explicitly defined
        const variableVars = context.variableValues ? Array.from(context.variableValues.keys()) : []
        for (const varName of variableVars) {
            result = result.replace(
                new RegExp(`\\$\{${varName}}(?!\\w)`, 'g'),
                context.variableValues?.get(varName) || ''
            )
        }
    }

    return result
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
    context?: IndexedExecutionContext
): string[] {
    const parentEdges = context?.edgeIndex.byTarget.get(nodeId) || []

    return parentEdges
        .map(edge => {
            let output = context?.nodeOutputs.get(edge.source)
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

// #region 1 CLI Node Execution */

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
    approvalHandler: (nodeId: string) => Promise<{ command?: string }>,
    context?: IndexedExecutionContext
): Promise<string> {
    abortSignal.throwIfAborted()
    if (!vscode.env.shell || !vscode.workspace.isTrusted) {
        throw new Error('Shell command is not supported in your current workspace.')
    }
    const inputs = combineParentOutputsByConnectionOrder(node.id, context)
    const command = node.data.content ? replaceIndexedInputs(node.data.content, inputs, context) : ''
    if (!command.trim()) {
        throw new Error('CLI Node requires a non-empty command')
    }

    const homeDir = os.homedir() || process.env.HOME || process.env.USERPROFILE || ''
    let filteredCommand = command.replaceAll(/(\s~\/)/g, ` ${homeDir}${path.sep}`) || ''

    if (node.data.needsUserApproval) {
        await webview.postMessage({
            type: 'node_execution_status',
            data: {
                nodeId: node.id,
                status: 'pending_approval',
                result: `${filteredCommand}`,
            },
        } as ExtensionToWorkflow)
        const approval = await approvalHandler(node.id)
        if (approval.command) {
            filteredCommand = approval.command
        }
    }

    if (commandsNotAllowed.some(cmd => sanitizeForShell(filteredCommand).startsWith(cmd))) {
        void vscode.window.showErrorMessage('Cody cannot execute this command')
        throw new Error('Cody cannot execute this command')
    }

    try {
        const { output, exitCode } = await persistentShell.execute(filteredCommand, abortSignal)
        if (exitCode !== '0' && node.data.shouldAbort) {
            throw new Error(output)
        }
        context?.cliMetadata?.set(node.id, { exitCode: exitCode })
        return output
    } catch (error: unknown) {
        persistentShell.dispose()
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`CLI Node execution failed: ${errorMessage}`) // Re-throw for handling in executeWorkflow
    }
}

// #endregion 1 CLI Node Execution

// #region 2 LLM Node Execution */

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
    abortSignal?: AbortSignal,
    context?: IndexedExecutionContext
): Promise<string> {
    abortSignal?.throwIfAborted()
    const oldTemperature = await chatClient.getTemperature()
    await chatClient.setTemperature((node as LLMNode).data.temperature)

    const inputs = combineParentOutputsByConnectionOrder(node.id, context).map(input =>
        sanitizeForPrompt(input)
    )
    const prompt = node.data.content ? replaceIndexedInputs(node.data.content, inputs, context) : ''
    if (!prompt || prompt.trim() === '') {
        throw new Error(`No prompt specified for LLM node ${node.id} with ${node.data.title}`)
    }

    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('LLM request timed out')), 60000)
    })

    try {
        const preamble = getSimplePreamble(
            (node as LLMNode).data.model?.id ?? 'anthropic::2024-10-22::claude-3-5-sonnet-latest',
            1,
            'Default'
        )
        const messages: Message[] = [
            ...preamble,
            {
                speaker: 'human',
                text: PromptString.unsafe_fromUserQuery(prompt),
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
                        model:
                            (node as LLMNode).data.model?.id ??
                            'anthropic::2024-10-22::claude-3-5-sonnet-latest',
                        isGoogleSearchEnabled: (node as LLMNode).data.hasGoogleSearch,
                    },
                    abortSignal
                )
                .then(async stream => {
                    const accumulated = new StringBuilder()
                    //let chunksProcessed = 0
                    try {
                        for await (const msg of stream) {
                            if (abortSignal?.aborted) reject('LLM Node Aborted')
                            if (msg.type === 'change') {
                                const newText = msg.text.slice(accumulated.length)
                                accumulated.append(newText)
                            }
                            if (msg.type === 'complete') {
                                resolve(accumulated.toString())
                                break
                            }
                            if (msg.type === 'error') {
                                reject(msg.error)
                                break
                            }
                        }
                    } catch (error) {
                        await chatClient.setTemperature(oldTemperature)
                        reject(error)
                    }
                })
                .catch(reject)
        })
        await chatClient.setTemperature(oldTemperature)
        return await Promise.race([streamPromise, timeout])
    } catch (error) {
        await chatClient.setTemperature(oldTemperature)
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                throw new Error('Workflow execution aborted')
            }
            throw new Error(`Failed to execute LLM node: ${error.message}`)
        }
        throw new Error('Unknown error in LLM node execution')
    }
}
// #endregion 2 LLM Node Execution */

// #region 3 Preview Node Execution */

/**
 * Executes a preview node in the workflow, trimming the input and sending the token count to the webview.
 *
 * @param input - The input string to be processed.
 * @param nodeId - The ID of the node being executed.
 * @param webview - The VSCode webview instance to send the token count to.
 * @returns The trimmed input string.
 */
async function executePreviewNode(
    nodeId: string,
    webview: vscode.Webview,
    context: IndexedExecutionContext
): Promise<string> {
    const input = combineParentOutputsByConnectionOrder(nodeId, context).join('\n')
    const processedInput = replaceIndexedInputs(input, [], context)
    const trimmedInput = processedInput.trim()
    const tokenCount = await TokenCounterUtils.encode(trimmedInput)

    await webview.postMessage({
        type: 'token_count',
        data: {
            nodeId,
            count: tokenCount.length,
        },
    } as ExtensionToWorkflow)

    return trimmedInput
}

// #endregion 3 Preview Node Execution */

/**
 * Executes an input node in the workflow, trimming the input string.
 *
 * @param input - The input string to be processed.
 * @returns The trimmed input string.
 */
async function executeInputNode(node: WorkflowNode, context: IndexedExecutionContext): Promise<string> {
    const inputs = combineParentOutputsByConnectionOrder(node.id, context)
    const text = node.data.content ? replaceIndexedInputs(node.data.content, inputs, context) : ''
    return text.trim()
}

// #region 4 Search Context Node Execution */

/**
 * Executes a search context node in the workflow, retrieving and formatting relevant context items based on the input.
 *
 * @param input - The input string to be used for retrieving the context.
 * @param contextRetriever - An object with a `retrieveContext` method that can be used to retrieve the context.
 * @returns An array of strings, where each string represents a formatted context item (path + newline + content).
 */
async function executeSearchContextNode(
    node: WorkflowNode,
    contextRetriever: Pick<ContextRetriever, 'retrieveContext'>,
    abortSignal: AbortSignal,
    context: IndexedExecutionContext
): Promise<string> {
    abortSignal.throwIfAborted()
    const inputs = combineParentOutputsByConnectionOrder(node.id, context)
    const text = node.data.content ? replaceIndexedInputs(node.data.content, inputs, context) : ''
    const allowRemoteContext = (node as SearchContextNode).data.local_remote
    const corpusItems = await firstValueFrom(getCorpusContextItemsForEditorState(allowRemoteContext))
    if (corpusItems === pendingOperation || corpusItems.length === 0) {
        return ''
    }
    const repo = corpusItems.find(i => i.type === 'tree' || i.type === 'repository')
    if (!repo) {
        return ''
    }
    const span = tracer.startSpan('chat.submit')
    const fetchedContext = await contextRetriever.retrieveContext(
        toStructuredMentions(corpusItems),
        PromptString.unsafe_fromLLMResponse(text),
        span,
        abortSignal,
        false
    )
    span.end()
    const result = fetchedContext.map(item => {
        // Format each context item as path + newline + content
        return `${item.uri.path}\n${item.content || ''}`
    })

    return result.join('\n----\n')
}

// #endregion 4 Search Context Node Execution */

// #region 5 Cody Output Node Execution */
/**
 * Executes an output node in the workflow, which involves continuing a chat session and waiting for new messages.
 *
 * @param input - The input string to be used for the chat.
 * @param contextItemsAsStringArray - An optional array of strings representing the context items to be used for the chat.
 * @param abortSignal - An AbortSignal that can be used to cancel the workflow execution.
 * @returns A Promise that resolves with the session ID of the completed chat session.
 */
async function executeCodyOutputNode(
    input: string,
    contextItemsAsStringArray: string[] | undefined,
    abortSignal: AbortSignal
): Promise<string> {
    abortSignal.throwIfAborted()
    const stringToContext = contextItemsAsStringArray
        ? stringToContextItems(contextItemsAsStringArray)
        : []

    return new Promise<string>((resolve, reject) => {
        // Handle workflow abortion
        abortSignal.addEventListener('abort', () => {
            reject(new Error('Workflow execution aborted'))
        })
        vscode.commands.executeCommand('cody.chat.focus').then(() =>
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
        )
    })
}

async function executeIfElseNode(
    context: IndexedExecutionContext,
    node: WorkflowNode | IfElseNode
): Promise<string> {
    let result = ''
    const parentEdges = context.edgeIndex.byTarget.get(node.id) || []
    let cliNode: WorkflowNodes | undefined
    let cliExitCode: string | undefined

    // Find the CLI parent node and its exit code
    for (const edge of parentEdges) {
        const parentNode = context.nodeIndex.get(edge.source)
        if (parentNode?.type === NodeType.CLI) {
            cliNode = parentNode
            cliExitCode = context.cliMetadata?.get(parentNode.id)?.exitCode
            break
        }
    }

    let hasResult: boolean

    if (cliNode) {
        hasResult = cliExitCode === '0'
        result = context.nodeOutputs.get(cliNode.id) as string
    } else {
        const inputs = combineParentOutputsByConnectionOrder(node.id, context)
        const condition = node.data.content
            ? replaceIndexedInputs(node.data.content, inputs, context)
            : ''

        const [leftSide, operator, rightSide] = condition.trim().split(/\s+(===|!==)\s+/)
        hasResult = operator === '===' ? leftSide === rightSide : leftSide !== rightSide
        result = hasResult ? 'true' : 'false'
    }

    // Get paths and mark nodes to skip
    context.ifelseSkipPaths?.set(node.id, new Set<string>())
    const edges = context.edgeIndex.bySource.get(node.id) || []
    const nonTakenPath = edges.find(edge => edge.sourceHandle === (hasResult ? 'false' : 'true'))
    if (nonTakenPath) {
        // Initialize ifelseSkipPaths if it's undefined
        if (!context.ifelseSkipPaths) {
            context.ifelseSkipPaths = new Map<string, Set<string>>()
        }

        // Get or create the set of nodes to skip for this IfElse node
        let skipNodes = context.ifelseSkipPaths?.get(node.id)

        skipNodes = new Set<string>()
        context.ifelseSkipPaths?.set(node.id, skipNodes)

        const allEdges = Array.from(context.edgeIndex.byId.values())
        const nodesToSkip = getInactiveNodes(allEdges, nonTakenPath.target)
        for (const nodeId of nodesToSkip) {
            skipNodes.add(nodeId)
        }
    }
    return result
}

// #endregion 5 Cody Output Node Execution */

/**
 * Converts an array of strings representing context items into an array of `ContextItem` objects.
 * Each string in the input array is expected to be in the format `"<file path>\n<file content>"`.
 * The function extracts the file path and content, and creates a `ContextItem` object with the appropriate properties.
 *
 * @param input - An array of strings representing context items.
 * @returns An array of `ContextItem` objects.
 */
function stringToContextItems(input: string[] | string | undefined): ContextItem[] {
    // Modified to accept string or string[]
    if (!input) {
        return []
    }

    let inputArray: string[] = []
    if (typeof input === 'string') {
        inputArray = input.split('\n----\n') // Split by the special delimiter
    } else {
        inputArray = input // Use input directly if it's already a string array
    }

    const contextItems: ContextItem[] = inputArray.map(line => {
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
    // Replace backslashes first to avoid double escaping in subsequent steps
    let sanitized = input.replace(/\\/g, '\\\\')

    // Escape ${} templates
    sanitized = sanitized.replace(/\${/g, '\\${')

    // Escape quotes
    sanitized = sanitized.replace(/"/g, '\\"')

    // Check for any remaining forbidden characters and escape them as well
    for (const char of ["'", ';']) {
        sanitized = sanitized.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`)
    }

    return sanitized
}

/** 
return (
        input
            .replace(/\\/g, '\\\\') // Escape backslashes
            .replace(/\${/g, '\\${') // Escape ${
            .replace(/"/g, '\\"') // Escape double quotes
            .replace(/`/g, '\\`') // Escape backticks
            //.replace(/'/g, `'\\''`) // Escape single quotes
            .replace(/;/g, '\\;') // Escape semicolons
            .replace(/&/g, '\\&') // Escape ampersands
            //.replace(/\|/g, '\\|') // Escape pipes
            .replace(/</g, '\\<') // Escape less than
            .replace(/>/g, '\\>') // Escape greater than
            .replace(/\(/g, '\\(') // Escape opening parenthesis
            .replace(/\)/g, '\\)') // Escape closing parenthesis
            .replace(/!/g, '\\!') // Escape exclamation mark
            .replace(/\?/g, '\\?') // Escape question mark
            
            //.replace(/\n/g, '\\n') // Escape newline
 *           .replace(/\t/g, '\\t') // Escape tab
 *           .replace(/\$/g, '\\$') // Escape literal dollar sign
    )
    **/

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

async function executeLoopStartNode(
    node: LoopStartNode,
    context: IndexedExecutionContext
): Promise<string> {
    // Helper function to filter edges by handle type
    const getInputsByHandle = (handleType: string) =>
        combineParentOutputsByConnectionOrder(node.id, {
            ...context,
            edgeIndex: {
                ...context.edgeIndex,
                byTarget: new Map([
                    [
                        node.id,
                        (context.edgeIndex.byTarget.get(node.id) || []).filter(
                            edge => edge.targetHandle === handleType
                        ),
                    ],
                ]),
            },
        })

    const mainInputs = getInputsByHandle('main')
    const iterationOverrides = getInputsByHandle('iterations-override')

    let loopState = context.loopStates.get(node.id)

    if (!loopState) {
        const maxIterations =
            iterationOverrides.length > 0
                ? Number.parseInt(iterationOverrides[0], 10) || node.data.iterations
                : node.data.iterations

        loopState = {
            currentIteration: 0, // Start at 0 for clearer iteration counting
            maxIterations,
            variable: node.data.loopVariable,
        }
        context.loopStates.set(node.id, loopState)
    } else if (loopState.currentIteration < loopState.maxIterations - 1) {
        context.loopStates.set(node.id, {
            ...loopState,
            currentIteration: loopState.currentIteration + 1,
        })
    }

    return mainInputs.join('\n')
}
