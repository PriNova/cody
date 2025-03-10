import * as vscode from 'vscode'
import type {
    ExtensionToWorkflow,
    WorkflowToExtension,
} from '../../webviews/workflow/services/WorkflowProtocol'

import {
    type ChatClient,
    ModelUsage,
    TokenCounterUtils,
    modelsService,
    pendingOperation,
} from '@sourcegraph/cody-shared'
import type { ContextRetriever } from '../chat/chat-view/ContextRetriever'
import { executeWorkflow } from './workflow-executor'
import {
    deleteCustomNode,
    getCustomNodes,
    handleWorkflowLoad,
    handleWorkflowSave,
    renameCustomNode,
    saveCustomNodes,
} from './workflow-io'

/**
 * Registers the Cody workflow commands in the Visual Studio Code extension context.
 *
 * This function sets up the necessary event handlers and message handlers for the Cody workflow editor webview panel.
 * It allows users to open the workflow editor, save the current workflow, load a previously saved workflow, and execute the current workflow.
 *
 * @param context - The Visual Studio Code extension context.
 * @param chatClient - The Cody chat client for executing the workflow.
 * @returns void
 */
export function registerWorkflowCommands(
    context: vscode.ExtensionContext,
    chatClient: ChatClient,
    contextRetriever: ContextRetriever
) {
    let activeAbortController: AbortController | null = null
    let pendingApprovalResolve: ((value: { command?: string }) => void) | null = null
    const waitForApproval = (nodeId: string): Promise<{ command?: string }> => {
        return new Promise(resolve => {
            pendingApprovalResolve = resolve
        })
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('cody.openWorkflowEditor', async () => {
            const panel = vscode.window.createWebviewPanel(
                'codyWorkflow',
                'Cody Workflow Editor',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
                }
            )

            // Handler for message from the webview
            panel.webview.onDidReceiveMessage(
                async (message: WorkflowToExtension) => {
                    switch (message.type) {
                        case 'get_models': {
                            const chatModelsSubscription = modelsService
                                .getModels(ModelUsage.Chat)
                                .subscribe(async models => {
                                    if (models !== pendingOperation) {
                                        await panel.webview.postMessage({
                                            type: 'models_loaded',
                                            data: models,
                                        } as ExtensionToWorkflow)
                                        chatModelsSubscription.unsubscribe()
                                    }
                                })
                            break
                        }
                        case 'save_workflow': {
                            const filename = await handleWorkflowSave(message.data)
                            if (filename) {
                                panel.title = `Workflow: ${filename}`
                            }
                            break
                        }
                        case 'load_workflow': {
                            const result = await handleWorkflowLoad()
                            if (result) {
                                if (result.filename) {
                                    panel.title = `Workflow: ${result.filename}`
                                }
                                await panel.webview.postMessage({
                                    type: 'workflow_loaded',
                                    data: result.data,
                                } as ExtensionToWorkflow)
                            }
                            break
                        }
                        case 'execute_workflow': {
                            if (message.data?.nodes && message.data?.edges) {
                                activeAbortController = new AbortController()
                                try {
                                    await executeWorkflow(
                                        message.data?.nodes || [],
                                        message.data?.edges || [],
                                        panel.webview,
                                        chatClient,
                                        activeAbortController.signal,
                                        contextRetriever,
                                        waitForApproval
                                    )
                                } finally {
                                    activeAbortController = null
                                }
                            }
                            break
                        }
                        case 'abort_workflow':
                            if (activeAbortController) {
                                activeAbortController.abort()
                                activeAbortController = null
                            }
                            break
                        case 'calculate_tokens': {
                            const count = await TokenCounterUtils.encode(message.data.text)
                            await panel.webview.postMessage({
                                type: 'token_count',
                                data: {
                                    nodeId: message.data.nodeId,
                                    count: count.length,
                                },
                            } as ExtensionToWorkflow)
                            break
                        }
                        case 'node_approved': {
                            if (pendingApprovalResolve) {
                                pendingApprovalResolve({
                                    command: message.data.modifiedCommand,
                                })
                                pendingApprovalResolve = null
                            }
                            break
                        }
                        case 'open_external_link': {
                            const url = vscode.Uri.parse(message.url)
                            vscode.env.openExternal(url)
                            break
                        }
                        case 'save_customNode': {
                            await saveCustomNodes(message.data)
                            const nodes = await getCustomNodes()
                            await panel.webview.postMessage({
                                type: 'provide_custom_nodes',
                                data: nodes,
                            } as ExtensionToWorkflow)
                            break
                        }
                        case 'get_custom_nodes': {
                            const nodes = await getCustomNodes()
                            await panel.webview.postMessage({
                                type: 'provide_custom_nodes',
                                data: nodes,
                            } as ExtensionToWorkflow)
                            break
                        }
                        case 'delete_customNode': {
                            await deleteCustomNode(message.data)
                            const nodes = await getCustomNodes()
                            await panel.webview.postMessage({
                                type: 'provide_custom_nodes',
                                data: nodes,
                            } as ExtensionToWorkflow)
                            break
                        }
                        case 'rename_customNode': {
                            await renameCustomNode(message.data.oldNodeTitle, message.data.newNodeTitle)
                            const nodes = await getCustomNodes()
                            await panel.webview.postMessage({
                                type: 'provide_custom_nodes',
                                data: nodes,
                            } as ExtensionToWorkflow)
                            break
                        }
                    }
                },
                undefined,
                context.subscriptions
            )

            // Clean Up
            panel.onDidDispose(() => {
                if (activeAbortController) {
                    activeAbortController.abort()
                    activeAbortController = null
                }
                panel.dispose()
            })

            const webviewPath = vscode.Uri.joinPath(context.extensionUri, 'dist/webviews')

            // Read the HTML file content
            const root = vscode.Uri.joinPath(webviewPath, 'workflow.html')
            const bytes = await vscode.workspace.fs.readFile(root)
            const decoded = new TextDecoder('utf-8').decode(bytes)
            const resources = panel.webview.asWebviewUri(webviewPath)

            // Replace variables in the HTML content
            panel.webview.html = decoded
                .replaceAll('./', `${resources.toString()}/`)
                .replaceAll('{cspSource}', panel.webview.cspSource)
        })
    )
}
