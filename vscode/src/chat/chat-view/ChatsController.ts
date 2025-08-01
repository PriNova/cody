import * as uuid from 'uuid'
import * as vscode from 'vscode'

import {
    type AuthenticatedAuthStatus,
    CODY_PASSTHROUGH_VSCODE_OPEN_COMMAND_ID,
    type ChatClient,
    DEFAULT_EVENT_SOURCE,
    type PromptMode,
    type SourcegraphGuardrailsClient,
    authStatus,
    currentAuthStatus,
    currentAuthStatusAuthed,
    editorStateFromPromptString,
    subscriptionDisposable,
} from '@sourcegraph/cody-shared'
import { logDebug, logError } from '../../output-channel-logger'
import type { MessageProviderOptions } from '../MessageProvider'

import type { URI } from 'vscode-uri'
import type { startTokenReceiver } from '../../auth/token-receiver'
import type { ExecuteChatArguments } from '../../commands/execute/ask'
import { getConfiguration } from '../../configuration'
import type { ExtensionClient } from '../../extension-client'
import { type ChatLocation, localStorage } from '../../services/LocalStorageProvider'
import {
    handleCodeFromInsertAtCursor,
    handleCodeFromSaveToNewFile,
} from '../../services/utils/codeblock-action-tracker'
import { CodyToolProvider } from '../agentic/CodyToolProvider'
import type { SmartApplyResult } from '../protocol'

import { requestEmptyDefaultContext } from '../initialContext'

import {
    ChatController,
    type ChatSession,
    disposeWebviewViewOrPanel,
    revealWebviewViewOrPanel,
    webviewViewOrPanelOnDidChangeViewState,
    webviewViewOrPanelViewColumn,
} from './ChatController'
import { chatHistory } from './ChatHistoryManager'
import type { ContextRetriever } from './ContextRetriever'

export const CodyChatEditorViewType = 'cody.editorPanel'

interface Options extends MessageProviderOptions {
    extensionUri: vscode.Uri
    startTokenReceiver?: typeof startTokenReceiver
}

export class ChatsController implements vscode.Disposable {
    // Chat view in the panel (typically in the sidebar)
    private readonly panel: ChatController

    // Chat views in editor panels
    private editors: ChatController[] = []
    private activeEditor: ChatController | undefined = undefined

    // We keep track of the currently authenticated account and dispose open chats when it changes
    private currentAuthAccount:
        | undefined
        | Pick<AuthenticatedAuthStatus, 'endpoint' | 'primaryEmail' | 'username'>

    protected disposables: vscode.Disposable[] = []

    constructor(
        private options: Options,
        private chatClient: ChatClient,
        private readonly contextRetriever: ContextRetriever,
        private readonly guardrails: SourcegraphGuardrailsClient,
        private readonly extensionClient: ExtensionClient
    ) {
        logDebug('ChatsController:constructor', 'init')
        this.panel = this.createChatController()

        this.disposables.push(
            subscriptionDisposable(
                authStatus.subscribe(authStatus => {
                    const hasLoggedOut = !authStatus.authenticated
                    const hasSwitchedAccount =
                        this.currentAuthAccount &&
                        this.currentAuthAccount.endpoint !== authStatus.endpoint
                    if (hasLoggedOut || hasSwitchedAccount) {
                        this.disposeAllChats()
                    }

                    this.currentAuthAccount = authStatus.authenticated ? { ...authStatus } : undefined
                })
            )
        )
    }

    public async restoreToPanel(panel: vscode.WebviewPanel, chatID: string): Promise<void> {
        try {
            await this.getOrCreateEditorChatController(chatID, panel.title, panel)
        } catch (error) {
            logDebug('ChatsController', 'restoreToPanel', { error })

            // When failed, create a new panel with restored session and dispose the old panel
            await this.getOrCreateEditorChatController(chatID, panel.title)
            panel.dispose()
        }
    }

    public async executePrompt({
        text,
        mode,
        autoSubmit,
    }: { text: string; mode: PromptMode; autoSubmit: boolean }): Promise<void> {
        // Get the appropriate controller (active editor, sidebar, or new instance)
        const [controller, isNew] = await this.getControllerForPrompt()

        if (controller.webviewPanelOrView) {
            if (isNew) {
                // Add a small delay before setting the prompt to ensure the webview has fully loaded
                await new Promise(resolve => setTimeout(resolve, 1500))
            }

            controller.webviewPanelOrView.webview.postMessage({
                type: 'clientAction',
                setPromptAsInput: {
                    text,
                    mode,
                    autoSubmit,
                },
            })
        }
    }

    /**
     * Gets the most appropriate controller for showing a prompt based on visibility and preference.
     * Returns a tuple with the controller and a boolean indicating if it's a newly created controller.
     */
    public async getControllerForPrompt(): Promise<[ChatController, boolean]> {
        const chatLocation = getNewChatLocation()

        if (chatLocation === 'sidebar') {
            await vscode.commands.executeCommand('cody.chat.focus')
            return [this.panel, false]
        }
        // Use existing active editor chat if available to avoid creating new instances
        if (this.activeEditor?.webviewPanelOrView?.visible) {
            return [this.activeEditor, false]
        }

        // Set the flag to use the empty default context before creating a new controller
        requestEmptyDefaultContext()
        // Create a new editor if none exist
        const controller = await this.getOrCreateEditorChatController()
        return [controller, true] // Flag as newly created
    }

    public registerViewsAndCommands() {
        this.disposables.push(
            vscode.window.registerWebviewViewProvider('cody.chat', this.panel, {
                webviewOptions: { retainContextWhenHidden: true },
            })
        )
        const restoreToEditor = async (
            chatID: string,
            chatQuestion?: string
        ): Promise<ChatSession | undefined> => {
            try {
                logDebug('ChatsController', 'debouncedRestorePanel')
                return await this.getOrCreateEditorChatController(chatID, chatQuestion)
            } catch (error) {
                logDebug('ChatsController', 'debouncedRestorePanel', 'failed', error)
                return undefined
            }
        }

        this.disposables.push(
            vscode.commands.registerCommand('cody.chat.moveToEditor', async () => {
                localStorage.setLastUsedChatModality('editor')
                return await this.moveChatFromPanelToEditor()
            }),
            vscode.commands.registerCommand('cody.chat.moveFromEditor', async () => {
                localStorage.setLastUsedChatModality('sidebar')
                return await this.moveChatFromEditorToPanel()
            }),
            vscode.commands.registerCommand('cody.action.chat', args => this.submitChat(args)),
            vscode.commands.registerCommand('cody.chat.signIn', () =>
                vscode.commands.executeCommand('cody.chat.focus')
            ),
            vscode.commands.registerCommand('cody.chat.newPanel', async args => {
                localStorage.setLastUsedChatModality('sidebar')
                const isVisible = this.panel.isVisible()
                await this.panel.clearAndRestartSession()

                try {
                    const { contextItems } = JSON.parse(args) || {}
                    if (contextItems?.length) {
                        await this.panel.addContextItemsToLastHumanInput(contextItems)
                    }
                } catch {}

                if (!isVisible) {
                    await vscode.commands.executeCommand('cody.chat.focus')
                }
            }),
            vscode.commands.registerCommand('cody.chat.newEditorPanel', async args => {
                localStorage.setLastUsedChatModality('editor')
                const panel = await this.getOrCreateEditorChatController()

                try {
                    const { contextItems } = JSON.parse(args) || {}
                    if (contextItems?.length) {
                        await panel.addContextItemsToLastHumanInput(contextItems)
                    }
                } catch {}

                return panel
            }),
            vscode.commands.registerCommand('cody.chat.new', async args => {
                switch (getNewChatLocation()) {
                    case 'editor':
                        return vscode.commands.executeCommand('cody.chat.newEditorPanel', args)
                    case 'sidebar':
                        return vscode.commands.executeCommand('cody.chat.newPanel', args)
                }
            }),

            vscode.commands.registerCommand('cody.chat.toggle', async () => this.toggleChatPanel()),
            vscode.commands.registerCommand('cody.chat.history.export', () => this.exportHistory()),
            vscode.commands.registerCommand('cody.chat.history.clear', arg => this.clearHistory(arg)),
            vscode.commands.registerCommand('cody.chat.history.delete', item => this.clearHistory(item)),
            vscode.commands.registerCommand('cody.chat.panel.restore', restoreToEditor),
            vscode.commands.registerCommand(CODY_PASSTHROUGH_VSCODE_OPEN_COMMAND_ID, (...args) =>
                this.passthroughVsCodeOpen(...args)
            ),
            vscode.commands.registerCommand('cody.show.lastUsedActions', async () => {
                this.panel.clientBroadcast.next({ type: 'open-recently-prompts' })
            }),

            // Mention selection/file commands
            vscode.commands.registerCommand('cody.mention.selection', uri =>
                this.sendEditorContextToChat(uri)
            ),
            vscode.commands.registerCommand('cody.mention.file', uri =>
                this.sendEditorContextToChat(uri)
            ),

            // Codeblock commands
            vscode.commands.registerCommand(
                'cody.command.markSmartApplyApplied',
                (result: SmartApplyResult) => this.sendSmartApplyResultToChat(result)
            ),
            vscode.commands.registerCommand(
                'cody.command.insertCodeToCursor',
                (args: { text: string }) => {
                    const text =
                        // Used in E2E tests where OS-native buttons dropdown is inaccessible.
                        process.env.CODY_TESTING === 'true'
                            ? 'cody.command.insertCodeToCursor:cody_testing'
                            : args.text

                    return handleCodeFromInsertAtCursor(text)
                }
            ),
            vscode.commands.registerCommand(
                'cody.command.insertCodeToNewFile',
                (args: { text: string }) => handleCodeFromSaveToNewFile(args.text, this.options.editor)
            )
        )
    }

    private async moveChatFromPanelToEditor(): Promise<void> {
        const sessionID = this.panel.sessionID
        await Promise.all([
            this.getOrCreateEditorChatController(sessionID),
            this.panel.clearAndRestartSession(),
        ])
    }

    private async moveChatFromEditorToPanel(): Promise<void> {
        const sessionID = this.activeEditor?.sessionID
        if (!sessionID) {
            return
        }
        await Promise.all([
            this.panel.restoreSession(sessionID),
            vscode.commands.executeCommand('workbench.action.closeActiveEditor'),
        ])
        await vscode.commands.executeCommand('cody.chat.focus')
    }

    private async sendEditorContextToChat(uri?: URI): Promise<void> {
        const provider = await this.getActiveChatController()
        if (provider === this.panel) {
            await vscode.commands.executeCommand('cody.chat.focus')
        }
        await provider.handleGetUserEditorContext(uri)
    }

    private async sendSmartApplyResultToChat(result: SmartApplyResult): Promise<void> {
        const provider = await this.getActiveChatController()
        await provider.handleSmartApplyResult(result)
    }

    /**
     * Gets the currently active chat panel provider.
     *
     * If editor panels exist, prefer those. Otherwise, return the sidebar provider.
     *
     * @returns {Promise<ChatController>} The active chat panel provider.
     */
    private async getActiveChatController(): Promise<ChatController> {
        // Check if any existing panel is available
        if (this.activeEditor) {
            // NOTE: Never reuse webviews when running inside the agent without native webviews
            // TODO: Find out, document why we don't reuse webviews when running inside agent without native webviews
            if (!getConfiguration().hasNativeWebview) {
                return await this.getOrCreateEditorChatController()
            }
            return this.activeEditor
        }
        return this.panel
    }

    /**
     * See docstring for {@link CODY_PASSTHROUGH_VSCODE_OPEN_COMMAND_ID}.
     */
    private async passthroughVsCodeOpen(...args: unknown[]): Promise<void> {
        if (args[1] && (args[1] as any).viewColumn === vscode.ViewColumn.Beside) {
            // Make vscode.ViewColumn.Beside work as expected from a webview: open it to the side,
            // instead of always opening a new editor to the right.
            //
            // If the active editor is undefined, that means the chat panel is the active editor, so
            // we will open the file in the first visible editor instead.
            const textEditor = vscode.window.activeTextEditor || vscode.window.visibleTextEditors[0]
            ;(args[1] as any).viewColumn = textEditor ? textEditor.viewColumn : vscode.ViewColumn.Beside
        }
        if (args[1] && Array.isArray((args[1] as any).selection)) {
            // Fix a weird issue where the selection was getting encoded as a JSON array, not an
            // object.
            ;(args[1] as any).selection = new vscode.Selection(
                (args[1] as any).selection[0],
                (args[1] as any).selection[1]
            )
        }
        await vscode.commands.executeCommand('vscode.open', ...args)
    }

    /**
     * Execute a chat request in a new chat panel or the sidebar chat panel.
     */
    private async submitChat({
        text,
        contextItems,
        source = DEFAULT_EVENT_SOURCE,
        command,
        submitType = 'new-chat',
    }: ExecuteChatArguments): Promise<ChatSession | ChatController | undefined> {
        let provider: ChatController
        // If the sidebar panel is visible and empty, use it instead of creating a new panel
        if (submitType === 'new-chat' && this.panel.isVisible() && this.panel.isEmpty()) {
            provider = this.panel
            // For now, always use the side panel if it's visible.
            // TODO: Let activeEditor be able to become this.panel,
            // thus handling both the side panel and a webview panel the same way.
        } else if (submitType === 'continue-chat' && this.panel.isVisible()) {
            provider = this.panel
        } else if (submitType === 'continue-chat' && this.activeEditor?.webviewPanelOrView?.visible) {
            provider = this.activeEditor
        } else {
            provider = await this.getOrCreateEditorChatController()
        }
        if (submitType === 'new-chat') {
            await provider.clearAndRestartSession()
        }
        const abortSignal = await provider.startNewSubmitOrEditOperation()
        const editorState = editorStateFromPromptString(text)
        await provider.handleUserMessage({
            requestID: uuid.v4(),
            inputText: text,
            mentions: contextItems ?? [],
            editorState,
            signal: abortSignal,
            source,
            command,
        })
        return provider
    }

    /**
     * Export chat history to file system
     */
    private async exportHistory(): Promise<void> {
        const authStatus = currentAuthStatus()
        if (authStatus.authenticated) {
            try {
                const historyJson = chatHistory.getLocalHistory(authStatus)
                const exportPath = await vscode.window.showSaveDialog({
                    title: 'Cody: Export Chat History',
                    filters: { 'Chat History': ['json'] },
                })
                if (!exportPath || !historyJson) {
                    return
                }
                const logContent = new TextEncoder().encode(JSON.stringify(historyJson))
                await vscode.workspace.fs.writeFile(exportPath, logContent)
                // Display message and ask if user wants to open file
                void vscode.window
                    .showInformationMessage('Chat history exported successfully.', 'Open')
                    .then(choice => {
                        if (choice === 'Open') {
                            void vscode.commands.executeCommand('vscode.open', exportPath)
                        }
                    })
            } catch (error) {
                logError('ChatsController:exportHistory', 'Failed to export chat history', error)
            }
        }
    }

    private async clearHistory(chatID?: string): Promise<void> {
        // The chat ID for client to pass in to clear all chats without showing window pop-up for confirmation.
        const ClearWithoutConfirmID = 'clear-all-no-confirm'
        const isClearAll = !chatID || chatID === ClearWithoutConfirmID
        const authStatus = currentAuthStatusAuthed()

        if (isClearAll) {
            if (chatID !== ClearWithoutConfirmID) {
                const userConfirmation = await vscode.window.showWarningMessage(
                    'Are you sure you want to delete all of your chats?',
                    { modal: true },
                    'Delete All Chats'
                )
                if (!userConfirmation) {
                    return
                }
            }
            await chatHistory.clear(authStatus)
            this.disposeAllChats()
            return
        }

        // For single chat deletion
        await chatHistory.deleteChat(authStatus, chatID)
        // Don't save the session when disposing after delete
        this.disposeChat(chatID, true, { skipSave: true })
    }

    /**
     * Returns a chat controller for a chat with the given chatID.
     * If an existing editor already exists, use that. Otherwise, create a new one.
     *
     * Post-conditions:
     * - The chat editor will be visible, have focus, and be marked as the active editor
     */
    private async getOrCreateEditorChatController(
        chatID?: string,
        chatQuestion?: string,
        panel?: vscode.WebviewPanel
    ): Promise<ChatController> {
        // For clients without editor chat panels support, always use the sidebar panel.
        const isSidebarOnly = this.extensionClient.capabilities?.webviewNativeConfig?.view === 'single'
        if (isSidebarOnly) {
            return this.panel
        }
        // Look for an existing editor with the same chatID
        if (chatID && this.editors.map(p => p.sessionID).includes(chatID)) {
            const provider = this.editors.find(p => p.sessionID === chatID)
            if (provider?.webviewPanelOrView) {
                revealWebviewViewOrPanel(provider.webviewPanelOrView)
                this.activeEditor = provider
                return provider
            }
        }
        return this.createEditorChatController(chatID, chatQuestion, panel)
    }

    /**
     * Creates a new editor panel
     */
    private async createEditorChatController(
        chatID?: string,
        chatQuestion?: string,
        panel?: vscode.WebviewPanel
    ): Promise<ChatController> {
        const chatController = this.createChatController()
        if (chatID) {
            chatController.restoreSession(chatID)
        }

        if (panel) {
            // Connect the controller with the existing editor panel
            this.activeEditor = chatController
            await chatController.revive(panel)
        } else {
            // Create a new editor panel on top of an existing one
            const activePanelViewColumn = this.activeEditor?.webviewPanelOrView
                ? webviewViewOrPanelViewColumn(this.activeEditor?.webviewPanelOrView)
                : undefined
            await chatController.createWebviewViewOrPanel(activePanelViewColumn, chatQuestion)
        }

        this.activeEditor = chatController
        this.editors.push(chatController)
        if (chatController.webviewPanelOrView) {
            webviewViewOrPanelOnDidChangeViewState(chatController.webviewPanelOrView)(e => {
                if (e.webviewPanel.visible && e.webviewPanel.active) {
                    this.activeEditor = chatController
                }
            })
            chatController.webviewPanelOrView.onDidDispose(() => {
                this.disposeChat(chatController.sessionID, false)
            })
        }

        return chatController
    }

    /**
     * Creates a provider for a chat view.
     */
    private createChatController(): ChatController {
        return new ChatController({
            ...this.options,
            chatClient: this.chatClient,
            guardrails: this.guardrails,
            startTokenReceiver: this.options.startTokenReceiver,
            contextRetriever: this.contextRetriever,
            extensionClient: this.extensionClient,
        })
    }

    private disposeChat(
        chatID: string,
        includePanel: boolean,
        options: { skipSave?: boolean } = {}
    ): void {
        if (chatID === this.activeEditor?.sessionID) {
            this.activeEditor = undefined
        }

        const providerIndex = this.editors.findIndex(p => p.sessionID === chatID)
        if (providerIndex !== -1) {
            const removedProvider = this.editors.splice(providerIndex, 1)[0]
            if (removedProvider.webviewPanelOrView) {
                disposeWebviewViewOrPanel(removedProvider.webviewPanelOrView)
            }
            removedProvider.dispose()
        }

        if (includePanel && chatID === this.panel?.sessionID && !options.skipSave) {
            this.panel.clearAndRestartSession()
        }
    }

    private async toggleChatPanel(): Promise<void> {
        if (this.activeEditor) {
            const isVisible = this.activeEditor.webviewPanelOrView?.visible
            const sessionID = this.activeEditor.sessionID
            if (isVisible && sessionID) {
                this.disposeChat(sessionID, true)
            } else {
                await this.getOrCreateEditorChatController(sessionID)
            }
        } else {
            await vscode.commands.executeCommand(
                this.panel.isVisible() ? 'workbench.action.toggleSidebarVisibility' : 'cody.chat.focus'
            )
        }
    }

    // Dispose all open chat panels
    private disposeAllChats(): void {
        this.activeEditor = undefined

        // loop through the panel provider map
        const oldEditors = this.editors
        this.editors = []
        for (const editor of oldEditors) {
            if (editor.webviewPanelOrView) {
                disposeWebviewViewOrPanel(editor.webviewPanelOrView)
            }
            editor.dispose()
        }

        this.panel.clearAndRestartSession()
    }

    public dispose(): void {
        this.disposeAllChats()
        CodyToolProvider.dispose()
        vscode.Disposable.from(...this.disposables).dispose()
    }
}

function getNewChatLocation(): ChatLocation {
    const chatDefaultLocation =
        vscode.workspace
            .getConfiguration()
            .get<'sticky' | 'sidebar' | 'editor'>('cody.chat.defaultLocation') ?? 'sticky'

    if (chatDefaultLocation === 'sticky') {
        return localStorage.getLastUsedChatModality()
    }
    return chatDefaultLocation
}
