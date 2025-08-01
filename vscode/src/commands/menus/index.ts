import { type CodyCommand, PromptString } from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import { commands, window } from 'vscode'
import { CommandMenuOption, CustomCommandConfigMenuItems } from './items/menu'

import { CustomCommandType } from '@sourcegraph/cody-shared'
import { CodyCommandMenuItems as defaultCommands } from '..'
import { executeEdit } from '../../edit/execute'
import { executeChat } from '../execute/ask'
import { openCustomCommandDocsLink } from '../services/custom-commands'
import type { CodyCommandArgs } from '../types'
import { type CustomCommandsBuilder, CustomCommandsBuilderMenu } from './command-builder'
import { type CommandMenuButton, CommandMenuSeperator, CommandMenuTitleItem } from './items/menu'
import type { CommandMenuItem } from './types'

export async function showCommandMenu(
    type: 'default' | 'custom' | 'config',
    customCommands: CodyCommand[],
    args?: CodyCommandArgs
): Promise<void> {
    const items: CommandMenuItem[] = []
    const configOption = CommandMenuOption.config
    const addOption = CommandMenuOption.add

    // Add items to menus accordingly:
    // 1. default: contains default commands and custom commands
    // 2. custom (custom commands): contain custom commands and add custom command option
    // 3. config (settings): setting options for custom commands
    if (type === 'config') {
        items.push(...CustomCommandConfigMenuItems)
    } else {
        // Add Default Commands
        if (type !== 'custom') {
            items.push(CommandMenuSeperator.commands)
            for (const item of defaultCommands) {
                if (
                    item.requires?.setting &&
                    !vscode.workspace.getConfiguration().get(item.requires?.setting)
                ) {
                    // Skip items that are missing the correct setting / feature flag.
                    continue
                }
                const key = item.key
                const label = `$(${item.icon}) ${item.description}`
                const command = item.command.command
                // Show keybind as description if present
                const description = item.keybinding ? item.keybinding : ''
                const type = 'default'
                items.push({ label, command, description, type, key })
            }
        }

        // Add Custom Commands
        if (customCommands?.length) {
            items.push(CommandMenuSeperator.custom)
            for (const customCommand of customCommands) {
                const label = `$(tools) ${customCommand.key}`
                const description = customCommand.description ?? customCommand.prompt
                const command = customCommand.key
                const key = customCommand.key
                const type = customCommand.type ?? CustomCommandType.User
                items.push({ label, description, command, type, key })
            }
        }

        // Extra options - Settings
        items.push(CommandMenuSeperator.settings)
        if (type === 'custom') {
            items.push(addOption) // Create New Custom Command option
        }
        items.push(configOption) // Configure Custom Command option
    }

    const options = CommandMenuTitleItem[type]

    return new Promise(resolve => {
        const quickPick = window.createQuickPick()
        quickPick.items = items
        quickPick.title = options.title
        quickPick.placeholder = options.placeHolder
        quickPick.matchOnDescription = true
        quickPick.buttons = CommandMenuTitleItem[type].buttons

        quickPick.onDidTriggerButton(async item => {
            // On gear icon click
            if (item.tooltip?.startsWith('Configure')) {
                await showCommandMenu('config', customCommands)
                return
            }
            // On back button click
            await showCommandMenu('default', customCommands)
            quickPick.hide()
        })

        // Open or delete custom command files
        quickPick.onDidTriggerItemButton(item => {
            const selected = item.item as CommandMenuItem
            const button = item.button as CommandMenuButton
            if (selected.type && button?.command) {
                void commands.executeCommand(button.command, selected.type)
            }
            quickPick.hide()
        })

        quickPick.onDidChangeValue(value => {
            if (type === 'default') {
                const commandKey = value.split(' ')[0]
                const isCommand = items.find(item => item.label === commandKey)
                if (commandKey && isCommand) {
                    isCommand.alwaysShow = true
                    quickPick.items = [isCommand]
                    return
                }

                if (value) {
                    quickPick.items = [
                        CommandMenuOption.chat,
                        CommandMenuOption.edit,
                        ...items.filter(i => i.key !== 'ask' && i.key !== 'edit'),
                    ]
                } else {
                    quickPick.items = items
                }
            }
        })

        quickPick.onDidAccept(async () => {
            const selection = quickPick.activeItems[0] as CommandMenuItem
            const value = PromptString.unsafe_fromUserQuery(normalize(quickPick.value))
            const source = 'menu'

            // On item button click
            if (selection.buttons && selection.type && selection.command) {
                void commands.executeCommand(selection.command, selection.type)
            }

            // Option to create a new custom command // config menu
            const commandOptions = [addOption.command, configOption.command]
            if (selection?.command && commandOptions.includes(selection.command)) {
                void commands.executeCommand(selection.command)
                quickPick.hide()
                return
            }

            // On selecting a default command
            if (selection.type === 'default' && selection.command) {
                // Check if it's an ask command
                if (selection.key === 'ask') {
                    // show input box if no value
                    if (value.length === 0) {
                        void commands.executeCommand('cody.chat.newEditorPanel')
                    } else {
                        void executeChat({
                            text: value.trim(),
                            source,
                        })
                    }
                    quickPick.hide()
                    return
                }

                // Check if it's an edit command
                if (selection.key === 'edit') {
                    void executeEdit({
                        configuration: { instruction: value },
                        source,
                    })
                    quickPick.hide()
                    return
                }

                void commands.executeCommand(selection.command, selection.type)
                quickPick.hide()
                return
            }

            // On selecting a custom command
            if (selection.key === selection.command) {
                void commands.executeCommand('cody.action.command', selection.key + ' ' + value)
                quickPick.hide()
                return
            }

            // Check if selection has a field called id
            const selectionHasIdField = Object.prototype.hasOwnProperty.call(selection, 'id')
            if (selectionHasIdField && (selection as CommandMenuItem).id === 'docs') {
                return openCustomCommandDocsLink()
            }

            resolve()
            quickPick.hide()
            return
        })
        quickPick.show()
    })
}

function normalize(input: string): string {
    return input.trim().toLowerCase()
}

/**
 * Show Menu for creating a new prompt via UI using the input box and quick pick without having to manually edit the cody.json file
 */
export async function showNewCustomCommandMenu(
    commands: string[]
): Promise<CustomCommandsBuilder | null> {
    const builder = new CustomCommandsBuilderMenu()
    return builder.start(commands)
}
