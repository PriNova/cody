import { type ChildProcess, exec, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
    type ContextItem,
    ContextItemSource,
    TokenCounterUtils,
    wrapInActiveSpan,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import { getConfiguration } from '../../configuration'
import { logError } from '../../output-channel-logger'

const execAsync = promisify(exec)

// Pre-compute home directory path
const HOME_DIR = os.homedir() || process.env.HOME || process.env.USERPROFILE || ''

const OUTPUT_WRAPPER = `
Terminal output from the \`{command}\` command enclosed between <OUTPUT0412> tags:
<OUTPUT0412>
{output}
</OUTPUT0412>`

// A persistent shell session that maintains state between commands
export class PersistentShell {
    private shell: ChildProcess | null = null
    private stdoutBuffer = ''
    private stderrBuffer = ''

    constructor() {
        this.init()
    }

    private init() {
        const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash'
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.path
        const shellArgs = process.platform === 'win32' ? [] : ['-l']
        this.shell = spawn(shell, shellArgs, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, LANG: 'en_US.UTF-8' },
        })

        this.shell.stdout?.on('data', data => {
            this.stdoutBuffer += data.toString()
        })

        this.shell.stderr?.on('data', data => {
            this.stderrBuffer += data.toString()
        })
    }

    async execute(cmd: string, abortSignal?: AbortSignal): Promise<string> {
        return new Promise((resolve, reject) => {
            // Remove the sanitization that replaces newlines
            // const sanitizedInput = cmd.replace(/\n/g, '\\n')
            const command = sanitizeCommand(cmd)

            if (!this.shell) {
                const error = new Error('Shell not initialized')
                void vscode.window.showErrorMessage(error.message)
                reject(error)
                return
            }
            this.stdoutBuffer = ''
            this.stderrBuffer = ''

            const checkInterval: NodeJS.Timeout = setInterval(() => {
                const combinedOutput = this.stdoutBuffer + this.stderrBuffer

                for (const [errorType, patterns] of Object.entries(SHELL_ERROR_PATTERNS)) {
                    if (Array.isArray(patterns)) {
                        for (const pattern of patterns) {
                            if (combinedOutput.toLowerCase().includes(pattern.toLowerCase())) {
                                clearTimeout(timeoutId)
                                clearInterval(checkInterval)
                                const error = new Error(`${errorType}: ${command}`)
                                reject(error)
                                return
                            }
                        }
                    }
                }

                if (this.stdoutBuffer.includes('__END_OF_COMMAND_')) {
                    clearTimeout(timeoutId)
                    clearInterval(checkInterval)

                    // Only reject if we got an actual error exit code
                    if (combinedOutput.includes('Command failed with exit code')) {
                        reject(new Error(this.stderrBuffer.trim()))
                    } else {
                        resolve(this.stdoutBuffer.split('__END_OF_COMMAND_')[0].trim())
                    }
                }

                if (abortSignal?.aborted) {
                    clearInterval(checkInterval)
                    clearTimeout(timeoutId)
                    this.kill() // Forcefully kill the process
                    reject(new Error('Command execution aborted'))
                    return
                }
            }, 100)

            const timeoutId = setTimeout(() => {
                clearInterval(checkInterval)
                const error = new Error('Command execution timed out')
                reject(error)
                this.dispose()
                this.init()
            }, 30000)

            // Key fix: Use set -o pipefail to catch pipeline failures
            this.shell.stdin?.write(`
                ${command}
                CMD_EXIT=$?
                if [ $CMD_EXIT -ne 0 ]; then
                    echo "Command failed with exit code $CMD_EXIT" >&2
                fi
                echo "__END_OF_COMMAND_${Date.now()}__"
            \n`)
        })
    }

    public kill(): void {
        if (this.shell) {
            this.shell.kill()
            this.shell = null
        }
    }

    public dispose(): void {
        if (this.shell) {
            this.shell.stdin?.end()
            this.shell.stdout?.removeAllListeners()
            this.shell.stderr?.removeAllListeners()
            this.shell.kill()
            this.shell = null
        }
        this.stdoutBuffer = ''
        this.stderrBuffer = ''
    }
}

export const shell: PersistentShell = new PersistentShell()

export async function getContextFileFromShell(command: string): Promise<ContextItem[]> {
    return wrapInActiveSpan('commands.context.command', async () => {
        const agenticShellConfig = getConfiguration()?.agenticContextExperimentalOptions?.shell
        if (!vscode.env.shell) {
            void vscode.window.showErrorMessage(
                'Shell command is not supported in your current workspace.'
            )
            return []
        }

        // Process command and workspace
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath
        const filteredCommand = command.replaceAll(/(\s~\/)/g, ` ${HOME_DIR}${path.sep}`)

        // Process user config list
        const allowList = new Set(agenticShellConfig?.allow ?? [])
        const blockList = new Set([...BASE_DISALLOWED_COMMANDS, ...(agenticShellConfig?.block ?? [])])

        try {
            // Command validation
            const commandStart = filteredCommand.split(' ')[0]
            if (
                (allowList?.size &&
                    !Array.from(allowList).some(cmd => filteredCommand.startsWith(cmd))) ||
                blockList.has(commandStart)
            ) {
                void vscode.window.showErrorMessage('Cody cannot execute this command')
                throw new Error('Cody cannot execute this command')
            }

            // Execute command
            const { stdout, stderr } = await execAsync(filteredCommand, { cwd, encoding: 'utf8' })
            const output = JSON.stringify(stdout || stderr).trim()

            if (!output || output === '""') {
                throw new Error('Empty output')
            }

            // Create context item
            const content = OUTPUT_WRAPPER.replace('{command}', command).replace('{output}', output)
            const size = await TokenCounterUtils.countTokens(content)

            return [
                {
                    type: 'file',
                    content,
                    title: 'Terminal Output',
                    uri: vscode.Uri.file(command),
                    source: ContextItemSource.Terminal,
                    size,
                },
            ]
        } catch (error) {
            logError('getContextFileFromShell', 'failed', { verbose: error })
            const errorContent = `Failed to run ${command} in terminal:\n${error}`
            const size = await TokenCounterUtils.countTokens(errorContent)

            return [
                {
                    type: 'file',
                    content: errorContent,
                    title: 'Terminal Output Error',
                    uri: vscode.Uri.file(command),
                    source: ContextItemSource.Terminal,
                    size,
                },
            ]
        }
    })
}

// Pre-defined base disallowed commands
const BASE_DISALLOWED_COMMANDS = [
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

// Create an enum or const object for shell types
const SHELL_ERROR_PATTERNS = {
    COMMAND_NOT_FOUND: [
        'command not found', // bash, zsh
        'is not recognized', // cmd.exe
        ': No such file or directory', // common unix
        'CommandNotFoundException', // powershell
        'Unknown command', // fish
        'not found in PATH', // some shells
        'not an executable', // some shells
        'cannot find the path', // windows variants
    ],
    PERMISSION_DENIED: ['Permission denied', 'Access is denied'],
    // Add more categories as needed
} as const

function sanitizeCommand(command: string): string {
    // Basic sanitization, should be more comprehensive in production
    return command.trim().replace(/(&(?!&)|[;`])(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/g, '')
}
