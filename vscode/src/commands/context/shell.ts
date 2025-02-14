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
        const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash'
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath
        this.shell = spawn(shell, [], {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        })

        this.shell.stdout?.on('data', data => {
            this.stdoutBuffer += data.toString()
        })

        this.shell.stderr?.on('data', data => {
            this.stderrBuffer += data.toString()
        })
    }

    public async execute(
        cmd: string,
        abortSignal?: AbortSignal
    ): Promise<{ output: string; exitCode: string }> {
        this.stdoutBuffer = ''
        this.stderrBuffer = ''
        let exitCode = 0

        return new Promise((resolve, reject) => {
            abortSignal?.throwIfAborted()
            const command = sanitizeCommand(cmd)
            if (!this.shell) {
                reject(new Error('Shell not initialized'))
                return
            }

            // Add exit code capture
            const getExitCodeCommand = process.platform === 'win32' ? 'echo %errorlevel%' : 'echo $?'
            this.shell.stdin?.write(`${command}` + '\n')
            this.shell.stdin?.write(`${getExitCodeCommand}\n`)

            const endMarker = `__END_OF_COMMAND_${Date.now()}__`
            this.shell.stdin?.write(`echo "${endMarker}"\n`)

            const timeout = 30000

            const timeoutId = setTimeout(() => {
                reject(new Error('Command execution timed out'))
                this.dispose()
                this.init()
            }, timeout)

            const abortListener = () => {
                clearTimeout(timeoutId)
                this.dispose()
                reject(new Error('Command execution aborted'))
                abortSignal?.removeEventListener('abort', abortListener)
            }
            abortSignal?.addEventListener('abort', abortListener)

            const checkBuffer = () => {
                if (this.stdoutBuffer.includes(endMarker)) {
                    //const sliceStart = process.platform === 'win32' ? 1 : 0
                    clearTimeout(timeoutId)
                    const outputParts = this.stdoutBuffer
                        .split(`echo "${endMarker}"`)[0]
                        .trim()
                        .split('\n')

                    // Extract exit code from the last line
                    exitCode = Number.parseInt(outputParts[outputParts.length - 2], 10)

                    // Remove exit code line from output
                    const output = outputParts
                        .slice(0, -2)
                        .filter(chunk => {
                            if (chunk.includes('(c) Microsoft Corporation.')) return false
                            if (chunk.includes('Microsoft Windows')) return false
                            if (chunk.match(/^[A-Za-z]:\\.*>.*$/)) return false
                            return true
                        })
                        .join('\n')

                    abortSignal?.removeEventListener('abort', abortListener)

                    // Return stderr if command failed, stdout otherwise
                    resolve({
                        output: exitCode !== 0 ? this.stderrBuffer : output,
                        exitCode: `${exitCode}`,
                    })
                } else {
                    setTimeout(checkBuffer, 100)
                }
            }

            checkBuffer()
        })
    }

    public kill(): void {
        if (this.shell) {
            this.shell.stdin!.end()
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

function sanitizeCommand(command: string): string {
    // Basic sanitization, should be more comprehensive in production
    return command.trim() //.replace(/(?<![&|])([;&|])/g, '')
}
