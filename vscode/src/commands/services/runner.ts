import * as vscode from 'vscode'

import type { Span } from '@opentelemetry/api'
import {
    ClientConfigSingleton,
    type CodyCommand,
    type ContextItem,
    DefaultChatCommands,
    type EventSource,
    PromptString,
} from '@sourcegraph/cody-shared'

import { type ExecuteEditArguments, executeEdit } from '../../edit/execute'
import type { EditMode } from '../../edit/types'
import { logDebug } from '../../output-channel-logger'

import type { CommandResult } from '../../CommandResult'
import type { ChatCommandResult, EditCommandResult } from '../../CommandResult'
import { getEditor } from '../../editor/active-editor'
import { getCommandContextFiles } from '../context'
import { executeChat } from '../execute/ask'
import type { CodyCommandArgs } from '../types'

/**
 * NOTE: Used by Command Controller only.
 * NOTE: Execute Custom Commands only
 *
 * Handles executing a Cody Custom Command.
 * It sorts the given command into:
 * - an inline edit command (mode !== 'ask), or;
 * - a chat command (mode === 'ask')
 *
 * Handles prompt building and context fetching for commands.
 */
export class CommandRunner implements vscode.Disposable {
    private disposables: vscode.Disposable[] = []

    constructor(
        private span: Span,
        private readonly command: CodyCommand,
        private readonly args: CodyCommandArgs
    ) {
        logDebug('CommandRunner', command.key, { verbose: { command, args } })
        // If runInChatMode is true, set mode to 'ask' to run as chat command
        // This allows users to run any edit commands in chat mode
        command.mode = args.runInChatMode ? 'ask' : command.mode ?? 'ask'

        this.command = command
    }

    /**
     * Starts executing the Cody Custom Command.
     */
    public async start(): Promise<CommandResult | undefined> {
        // NOTE: Default commands are processed in controller
        if (this.command.type === 'default') {
            console.error('Default commands are not supported in runner.')
            return undefined
        }

        // Conditions checks
        const clientConfig = await ClientConfigSingleton.getInstance().getConfig()
        if (!clientConfig?.customCommandsEnabled) {
            const disabledMsg = 'This feature has been disabled by your Sourcegraph site admin.'
            void vscode.window.showErrorMessage(disabledMsg)
            this.span.end()
            return
        }
        const editor = getEditor()
        if (!editor.active || editor.ignored) {
            const message = editor.ignored
                ? 'Current file is ignored by a .cody/ignore file. Please remove it from the list and try again.'
                : 'No editor is active. Please open a file and try again.'
            void vscode.window.showErrorMessage(message)
            this.span.end()
            return
        }

        // Execute the command based on the mode
        // Run as edit command if mode is not 'ask'
        if (this.command.mode !== 'ask') {
            return this.handleEditRequest()
        }

        return this.handleChatRequest()
    }

    /**
     * Handles a Cody chat command.
     * Executes the chat request with the prompt and context files
     */
    private async handleChatRequest(): Promise<ChatCommandResult | undefined> {
        this.span.setAttribute('mode', 'chat')
        logDebug('CommandRunner:handleChatRequest', 'chat request detecte')

        const prompt = PromptString.unsafe_fromUserQuery(this.command.prompt)

        // Fetch context for the command
        const contextItems = await this.getContextFiles()

        // NOTE: (bee) codebase context is not supported for custom commands
        return {
            type: 'chat',
            session: await executeChat({
                text: prompt,
                contextItems,
                source: 'custom-commands',
                command: DefaultChatCommands.Custom,
            }),
        }
    }

    /**
     * handleFixupRequest method handles executing fixup based on editor selection.
     * Creates range and instruction, calls fixup command.
     */
    private async handleEditRequest(): Promise<EditCommandResult | undefined> {
        this.span.setAttribute('mode', 'edit')
        logDebug('CommandRunner:handleEditRequest', 'fixup request detected')

        // Fetch context for the command
        const userContextFiles = await this.getContextFiles()

        return {
            type: 'edit',
            task: await executeEdit({
                configuration: {
                    instruction: PromptString.unsafe_fromUserQuery(this.command.prompt),
                    intent: 'edit',
                    mode: this.command.mode as EditMode,
                    userContextFiles,
                },
                source: 'custom-commands' as EventSource,
            } satisfies ExecuteEditArguments),
        }
    }

    /**
     * Combine userContextFiles and context fetched for the command
     */
    private async getContextFiles(): Promise<ContextItem[]> {
        const contextConfig = this.command.context
        this.span.setAttribute('contextConfig', JSON.stringify(contextConfig))

        const userContextFiles = this.args.userContextFiles ?? []
        if (contextConfig) {
            const commandContext = await getCommandContextFiles(contextConfig)
            userContextFiles.push(...commandContext)
        }
        return userContextFiles
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.disposables = []
    }
}
