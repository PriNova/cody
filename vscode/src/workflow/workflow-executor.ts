import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { type ChatClient, type Message, PromptString } from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import type { Edge } from '../../webviews/workflow/components/CustomOrderedEdge'
import type { WorkflowNode } from '../../webviews/workflow/components/nodes/Nodes'
import type { WorkflowFromExtension } from '../../webviews/workflow/services/WorkflowProtocol'

interface ExecutionContext {
    nodeOutputs: Map<string, string>
    //signal: AbortSignal
}

let activeProcess: ChildProcess | null = null

/**
 * Performs a topological sort on the given workflow nodes and edges, returning the sorted nodes.
 *
 * @param nodes - The workflow nodes to sort.
 * @param edges - The edges between the workflow nodes.
 * @returns The sorted workflow nodes.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
    const graph = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    // Initialize
    for (const node of nodes) {
        graph.set(node.id, [])
        inDegree.set(node.id, 0)
    }

    // Build graph
    for (const edge of edges) {
        graph.get(edge.source)?.push(edge.target)
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
    }

    // Find nodes with no dependencies but sort them based on their edge connections
    const sourceNodes = nodes.filter(node => inDegree.get(node.id) === 0)

    // Sort source nodes based on edge order
    const sortedSourceNodes = sourceNodes.sort((a, b) => {
        const aEdgeIndex = edges.findIndex(edge => edge.source === a.id)
        const bEdgeIndex = edges.findIndex(edge => edge.source === b.id)
        return aEdgeIndex - bEdgeIndex
    })

    const queue = sortedSourceNodes.map(node => node.id)
    const result: string[] = []
    while (queue.length > 0) {
        const nodeId = queue.shift()!
        result.push(nodeId)

        const neighbors = graph.get(nodeId)
        if (neighbors) {
            for (const neighbor of neighbors) {
                inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1)
                if (inDegree.get(neighbor) === 0) {
                    queue.push(neighbor)
                }
            }
        }
    }

    return result.map(id => nodes.find(node => node.id === id)!).filter(Boolean)
}

/**
 * Executes a CLI node in a workflow, running the specified shell command and returning its output.
 *
 * @param node - The workflow node to execute.
 * @param abortSignal - The abort signal to cancel the execution.
 * @returns The output of the shell command.
 * @throws {Error} If the shell is not available, the workspace is not trusted, or the command fails to execute.
 */
async function executeCLINode(node: WorkflowNode, abortSignal: AbortSignal): Promise<string> {
    if (!vscode.env.shell || !vscode.workspace.isTrusted) {
        throw new Error('Shell command is not supported in your current workspace.')
    }

    const homeDir = os.homedir() || process.env.HOME || process.env.USERPROFILE || ''
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.path

    const filteredCommand = node.data.command?.replaceAll(/(\s~\/)/g, ` ${homeDir}${path.sep}`) || ''

    if (commandsNotAllowed.some(cmd => filteredCommand.startsWith(cmd))) {
        void vscode.window.showErrorMessage('Cody cannot execute this command')
        throw new Error('Cody cannot execute this command')
    }

    return new Promise((resolve, reject) => {
        const shell = process.platform === 'win32' ? 'cmd' : 'bash'
        const shellFlag = process.platform === 'win32' ? '/c' : '-c'

        activeProcess = spawn(shell, [shellFlag, filteredCommand], { cwd })
        let stdout = ''
        let stderr = ''

        activeProcess.stdout?.on('data', data => {
            stdout += data.toString()
        })

        activeProcess.stderr?.on('data', data => {
            stderr += data.toString()
        })

        activeProcess.on('close', code => {
            activeProcess = null
            if (code === 0) {
                resolve(stdout.replace(/\n$/, ''))
            } else {
                reject(new Error(stderr || `Process exited with code ${code}`))
            }
        })

        activeProcess.on('error', error => {
            activeProcess = null
            reject(error)
        })

        // Handle abortion
        abortSignal.addEventListener('abort', () => {
            if (activeProcess) {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', activeProcess.pid?.toString() || '', '/f', '/t'])
                } else {
                    try {
                        // Try to kill process group first
                        process.kill(-activeProcess.pid!, 'SIGTERM')
                    } catch {
                        // If process group kill fails, try killing single process without logging error
                        try {
                            process.kill(activeProcess.pid!, 'SIGTERM')
                        } catch {
                            // Process already terminated, ignore error
                        }
                    }
                }
                activeProcess = null
                reject(new Error('CLI command execution aborted'))
            }
        })
    })
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
    abortSignal: AbortSignal
): Promise<string> {
    if (!node.data.prompt) {
        throw new Error(`No prompt specified for LLM node ${node.id} with ${node.data.title}`)
    }

    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('LLM request timed out')), 30000)
    })

    try {
        const messages: Message[] = [
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
                        maxTokensToSample: 1000,
                        model: 'anthropic::2024-10-22::claude-3-5-sonnet-latest',
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

async function executePreviewNode(input: string): Promise<string> {
    return input
}

async function executeInputNode(input: string): Promise<string> {
    return input
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
    context: ExecutionContext,
    nodeType: string
): string[] {
    const parentEdges = edges.filter(edge => edge.target === nodeId)
    return parentEdges
        .map(edge => {
            const output = context.nodeOutputs.get(edge.source)
            if (output === undefined) {
                return ''
            }
            if (nodeType === 'cli') {
                return sanitizeForShell(output)
            }
            if (nodeType === 'llm') {
                return sanitizeForPrompt(output)
            }
            return output
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
    abortController: AbortSignal
): Promise<void> {
    //const abortController = new AbortController()
    const context: ExecutionContext = {
        nodeOutputs: new Map(),
        //signal: abortController.signal,
    }

    const sortedNodes = topologicalSort(nodes, edges)

    webview.postMessage({
        type: 'execution_started',
    } as WorkflowFromExtension)

    for (const node of sortedNodes) {
        try {
            webview.postMessage({
                type: 'node_execution_status',
                data: { nodeId: node.id, status: 'running' },
            } as WorkflowFromExtension)

            let result: string
            switch (node.type) {
                case 'cli': {
                    const inputs = combineParentOutputsByConnectionOrder(
                        node.id,
                        edges,
                        context,
                        node.type
                    )
                    const command = node.data.command
                        ? replaceIndexedInputs(node.data.command, inputs)
                        : ''
                    result = await executeCLINode(
                        { ...node, data: { ...node.data, command } },
                        abortController
                    )
                    break
                }
                case 'llm': {
                    const inputs = combineParentOutputsByConnectionOrder(
                        node.id,
                        edges,
                        context,
                        node.type
                    )
                    const prompt = node.data.prompt ? replaceIndexedInputs(node.data.prompt, inputs) : ''
                    result = await executeLLMNode(
                        { ...node, data: { ...node.data, prompt } },
                        chatClient,
                        abortController
                    )
                    break
                }
                case 'preview': {
                    const inputs = combineParentOutputsByConnectionOrder(
                        node.id,
                        edges,
                        context,
                        node.type
                    )
                    result = await executePreviewNode(inputs.join('\n'))
                    break
                }

                case 'text-format': {
                    const inputs = combineParentOutputsByConnectionOrder(
                        node.id,
                        edges,
                        context,
                        node.type
                    )
                    const text = node.data.content ? replaceIndexedInputs(node.data.content, inputs) : ''
                    result = await executeInputNode(text)
                    break
                }
                default:
                    throw new Error(`Unknown node type: ${node.type}`)
            }

            context.nodeOutputs.set(node.id, result)
            webview.postMessage({
                type: 'node_execution_status',
                data: { nodeId: node.id, status: 'completed', result },
            } as WorkflowFromExtension)
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            const status = errorMessage === 'CLI command execution aborted' ? 'interrupted' : 'error'

            webview.postMessage({
                type: 'node_execution_status',
                data: { nodeId: node.id, status, result: errorMessage },
            } as WorkflowFromExtension)

            webview.postMessage({
                type: 'execution_completed',
            } as WorkflowFromExtension)
        }
    }

    webview.postMessage({
        type: 'execution_completed',
    } as WorkflowFromExtension)
}

function sanitizeForShell(input: string): string {
    return input.replace(/(["\\'$`])/g, '\\$1').replace(/\n/g, ' ')
}

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
