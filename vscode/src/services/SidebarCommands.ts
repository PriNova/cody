import * as vscode from 'vscode'

import { CodyIDE } from '@sourcegraph/cody-shared'
import {
    ACCOUNT_LIMITS_INFO_URL,
    ACCOUNT_UPGRADE_URL,
    ACCOUNT_USAGE_URL,
    CODY_DOC_URL,
    CODY_FEEDBACK_URL,
    CODY_SUPPORT_URL,
    DISCORD_URL,
} from '../chat/protocol'
import { getReleaseNotesURLByIDE } from '../release'
import { version } from '../version'

export function registerSidebarCommands(): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('cody.sidebar.commands', (feature: string, command: string) => {
            // For Custom Commands
            if (command === 'cody.action.command') {
                void vscode.commands.executeCommand(command, feature, { source: 'sidebar' })
                return
            }

            void vscode.commands.executeCommand(command, { source: 'sidebar' })
        }),
        vscode.commands.registerCommand('cody.show-page', (page: string) => {
            let url: URL
            switch (page) {
                case 'upgrade':
                    url = ACCOUNT_UPGRADE_URL
                    break
                case 'usage':
                    url = ACCOUNT_USAGE_URL
                    break
                case 'rate-limits':
                    url = ACCOUNT_LIMITS_INFO_URL
                    break
                default:
                    console.warn(`Unable to show unknown page: "${page}"`)
                    return
            }
            void vscode.env.openExternal(vscode.Uri.parse(url.toString()))
        }),
        vscode.commands.registerCommand('cody.sidebar.settings', () => {
            void vscode.commands.executeCommand('cody.status-bar.interacted')
        }),
        vscode.commands.registerCommand('cody.sidebar.keyboardShortcuts', () => {
            void vscode.commands.executeCommand(
                'workbench.action.openGlobalKeybindings',
                '@ext:sourcegraph.cody-ai'
            )
        }),
        vscode.commands.registerCommand('cody.sidebar.releaseNotes', () => {
            void vscode.commands.executeCommand(
                'vscode.open',
                getReleaseNotesURLByIDE(version, CodyIDE.VSCode)
            )
        }),
        vscode.commands.registerCommand('cody.sidebar.documentation', () => {
            void vscode.commands.executeCommand('vscode.open', CODY_DOC_URL.href)
        }),
        vscode.commands.registerCommand('cody.sidebar.support', () => {
            void vscode.commands.executeCommand('vscode.open', CODY_SUPPORT_URL.href)
        }),
        vscode.commands.registerCommand('cody.sidebar.feedback', () => {
            void vscode.commands.executeCommand('vscode.open', CODY_FEEDBACK_URL.href)
        }),
        vscode.commands.registerCommand('cody.sidebar.discord', () => {
            void vscode.commands.executeCommand('vscode.open', DISCORD_URL.href)
        }),
        vscode.commands.registerCommand('cody.sidebar.account', () => {
            void vscode.commands.executeCommand('cody.auth.account')
        }),
        vscode.commands.registerCommand('cody.sidebar.logs', () => {
            void vscode.commands.executeCommand('cody.debug.export.logs')
        }),
    ]
}
