import {
    type ChatClient,
    type ChatMessage,
    type CompletionGeneratorValue,
    type ContextItem,
    type Message,
    type Model,
    type ModelContextWindow,
    ModelTag,
    ModelUsage,
    Typewriter,
    getSimplePreamble,
    modelsService,
    pluralize,
    skipPendingOperation,
    subscriptionDisposable,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import { outputChannelLogger } from '../../output-channel-logger'
import { PromptBuilder } from '../../prompt-builder'
import type { API, GitExtension, InputBox, Repository } from '../../repository/builtinGitExtension'
import {
    getContextFilesFromGitDiff,
    getContextFilesFromGitLog,
    getGitCommitTemplateContextFile,
} from '../context/git-api'
import { COMMIT_COMMAND_PROMPTS, getCustomCommitTemplate } from './prompts'

export class CodySourceControl implements vscode.Disposable {
    private disposables: vscode.Disposable[] = []
    private gitAPI: API | undefined
    private abortController: AbortController | undefined
    private model: Model | undefined

    private commitTemplate?: string

    constructor(private readonly chatClient: ChatClient) {
        // Register commands
        this.disposables.push(
            vscode.commands.registerCommand('cody.command.generate-commit', scm => this.generate(scm)),
            vscode.commands.registerCommand('cody.command.abort-commit', () => this.statusUpdate()),
            subscriptionDisposable(
                modelsService
                    .getModels(ModelUsage.Edit)
                    .pipe(skipPendingOperation())
                    .subscribe(models => {
                        // Remove experimental and preview models
                        const filtered = models.filter(
                            m =>
                                !m.tags.includes(ModelTag.Experimental) &&
                                !m.tags.includes(ModelTag.Internal)
                        )
                        const flashLite = filtered.find(m => m.id.endsWith('gemini-2.0-flash-lite'))
                        const flash = filtered.find(m => m.id.endsWith('gemini-2.0-flash'))
                        this.model = flash ?? flashLite ?? filtered.at(0)
                    })
            )
        )
        this.initializeGitAPI()
    }

    /**
     * Initialize and manage the git extension and API
     */
    private async initializeGitAPI() {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')
        await extension?.activate()
        this.gitAPI = extension?.exports?.getAPI(1)

        // React to enablement changes
        const onEnablementChange = extension?.exports?.onDidChangeEnablement(enabled => {
            this.gitAPI = enabled ? extension.exports.getAPI(1) : undefined
        })

        // React to configuration changes
        const onConfigChange = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('git.enabled')) {
                const gitConfig = vscode.workspace.getConfiguration('git')
                this.gitAPI = gitConfig.get<boolean>('enabled')
                    ? extension?.exports.getAPI(1)
                    : undefined
            }
        })

        this.disposables.push(onConfigChange, onEnablementChange?.dispose())
    }

    /**
     * Generates a commit message based on the current git output.
     *
     * @param scm - The source control instance to use for the commit message generation.
     */
    public async generate(scm?: vscode.SourceControl): Promise<void> {
        const currentWorkspaceUri = scm?.rootUri ?? vscode.workspace.workspaceFolders?.[0]?.uri
        if (!this.gitAPI || !currentWorkspaceUri) {
            vscode.window.showInformationMessage('Git is not available in the current workspace.')
            return
        }

        if (this.abortController) {
            vscode.window.showInformationMessage('There is a commit message generation in progress.')
            return
        }

        const repository = this.gitAPI.getRepository(currentWorkspaceUri)
        const sourceControlInputbox = scm?.inputBox ?? repository?.inputBox
        if (!sourceControlInputbox || !repository) {
            vscode.window.showInformationMessage('Your source control provider is not supported.')
            return
        }

        // Get Commit Template from config and set it when available.
        if (!this.commitTemplate) {
            if (scm?.commitTemplate) {
                this.commitTemplate = scm.commitTemplate
            } else {
                // In the case that VSCode's SCM integration didn't read the commit template,
                // look for via `git config --get`
                const [localTemplateFilePath, globalTemplateFilePath] = await Promise.all([
                    repository.getConfig('commit.template'),
                    repository.getGlobalConfig('commit.template'),
                ])
                const commitTemplateFilePath = localTemplateFilePath ?? globalTemplateFilePath
                if (commitTemplateFilePath) {
                    try {
                        this.commitTemplate = await vscode.workspace.fs
                            .readFile(vscode.Uri.file(commitTemplateFilePath))
                            .then(buffer => new TextDecoder().decode(buffer))
                    } catch (error) {
                        console.error(
                            `Failed to read commit template file: ${commitTemplateFilePath}`,
                            error
                        )
                    }
                }
            }
        }

        // Open the vscode source control view to show the progress.
        void vscode.commands.executeCommand('workbench.view.scm')
        // Focus the workbench view to show the progress.
        void vscode.commands.executeCommand('workbench.scm.focus')

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.SourceControl,
                title: 'Generating commit message...',
                cancellable: true,
            },
            async (progress, token) => {
                this.stream(repository, sourceControlInputbox, progress, token, this.commitTemplate)
            }
        )
    }

    private async stream(
        repository: Repository,
        sourceControlInputbox: vscode.SourceControlInputBox | InputBox,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken,
        commitTemplate?: string
    ): Promise<void> {
        // Update context status to indicate that Cody is generating a commit message.
        const abortController = new AbortController()
        this.statusUpdate(abortController)

        const initialInputBoxValue = sourceControlInputbox.value
        const initialPlaceholder = (sourceControlInputbox as vscode.SourceControlInputBox).placeholder

        const generatingCommitTitle = 'Generating commit message...'
        if (initialPlaceholder !== undefined) {
            sourceControlInputbox.value = ''
            ;(sourceControlInputbox as vscode.SourceControlInputBox).placeholder = generatingCommitTitle
        } else {
            sourceControlInputbox.value = generatingCommitTitle
        }

        progress.report({ message: generatingCommitTitle })
        try {
            token.onCancellationRequested(() => {
                progress.report({ message: 'Aborted' })
                this.statusUpdate()
            })

            if (!this.model) {
                throw new Error('No models available')
            }

            const { id: model, contextWindow } = this.model

            const diffContext = await getContextFilesFromGitDiff(repository)

            const logContext = await getContextFilesFromGitLog(repository).catch(error => {
                // we can generate a commit message without log context
                // but in case the user wants to see what happened, record the error
                outputChannelLogger.logError('getContextFilesFromGitLog', 'failed', error)
                return []
            })

            const context = [...diffContext, ...logContext]

            if (commitTemplate) {
                context.push(await getGitCommitTemplateContextFile(commitTemplate))
            }

            const { prompt, ignoredContext, contextTooBig } = await this.buildPrompt(
                contextWindow,
                getSimplePreamble(model, 1, 'Default', COMMIT_COMMAND_PROMPTS.intro),
                context,
                commitTemplate
            )

            if (ignoredContext.length === diffContext.length) {
                // All of the files being committed are either too big for the context window,
                // or are on the Cody ignore list.
                // No matter the reason, all of them are being skipped,
                // and we can't generate a commit message without any context.
                let message = 'Cody was forced to skip all of the files being committed'
                if (contextTooBig) {
                    message += ' because they exceeded the context window limit'
                }
                throw new Error(message)
            }

            const stream = await this.chatClient.chat(
                prompt,
                { model, maxTokensToSample: contextWindow.output },
                abortController?.signal
            )

            // Function to update the input box with the latest text
            const updateInputBox = (text: string, hasStopped = false) => {
                sourceControlInputbox.value = text
                hasStopped && this.statusUpdate()
            }

            await streaming(stream, abortController, updateInputBox, progress)

            if (ignoredContext.length > 0) {
                let message = `Cody was forced to skip ${ignoredContext.length} ${pluralize(
                    'file',
                    ignoredContext.length,
                    'files'
                )} when generating the commit message`
                if (contextTooBig) {
                    message += ` because ${pluralize(
                        'it',
                        ignoredContext.length,
                        'they'
                    )} exceeded the context token limit`
                }
                outputChannelLogger.logError('Generate Commit Message', message)
                vscode.window.showInformationMessage(message)
            }
        } catch (error) {
            this.statusUpdate()
            progress.report({ message: 'Error' })
            sourceControlInputbox.value = initialInputBoxValue // Revert to initial value on error
            outputChannelLogger.logError('Generate Commit Message', 'failed', error)
            let errorMessage = 'Could not generate a commit message'
            if (error instanceof Error && error.message) {
                errorMessage += `: ${error.message}`
            }
            vscode.window.showInformationMessage(errorMessage)
        } finally {
            if (initialPlaceholder !== undefined) {
                ;(sourceControlInputbox as vscode.SourceControlInputBox).placeholder = initialPlaceholder
            }
        }
    }

    private async buildPrompt(
        contextWindow: ModelContextWindow,
        preamble: Message[],
        context: ContextItem[],
        commitTemplate?: string
    ): Promise<{ prompt: Message[]; ignoredContext: ContextItem[]; contextTooBig: boolean }> {
        if (!context.length) {
            throw new Error('Failed to get git output.')
        }

        const templateMessage = await getCustomCommitTemplate()
        const customTemplate = templateMessage ? templateMessage : COMMIT_COMMAND_PROMPTS.template
        const templatePrompt = this.commitTemplate ? COMMIT_COMMAND_PROMPTS.noTemplate : customTemplate
        const text = COMMIT_COMMAND_PROMPTS.instruction.replace('{COMMIT_TEMPLATE}', templatePrompt)
        const transcript: ChatMessage[] = [{ speaker: 'human', text }]

        const promptBuilder = await PromptBuilder.create(contextWindow)
        promptBuilder.tryAddToPrefix(preamble)
        promptBuilder.tryAddMessages(transcript.reverse())

        const { ignored: ignoredContext, limitReached: contextTooBig } =
            await promptBuilder.tryAddContext('user', context)
        return { prompt: promptBuilder.build(), ignoredContext, contextTooBig }
    }

    /**
     * Updates the commit generation state and sets the corresponding context status.
     * If an `abortController` is provided, it is used to abort the current commit generation.
     *
     * @param abortController - An optional `AbortController` instance to use for aborting the current commit generation.
     */
    private statusUpdate(abortController?: AbortController): void {
        const isGenerating = abortController !== undefined
        const contextID = 'cody.isGeneratingCommit'
        vscode.commands.executeCommand('setContext', contextID, isGenerating)

        this.abortController?.abort()
        this.abortController = abortController
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            if (disposable) {
                disposable.dispose()
            }
        }
        this.disposables = []
    }
}

async function streaming(
    stream: AsyncIterable<CompletionGeneratorValue>,
    abortController: AbortController,
    updateInputBox: (text: string, hasStopped?: boolean) => void,
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
    // Ensure commitText is defined outside the loop for scope retention
    let commitText = ''
    const typewriter = new Typewriter({
        update(content): void {
            updateInputBox(content)
        },
        close() {
            updateInputBox(commitText, true)
        },
    })

    for await (const message of stream) {
        // Keep using the streamed value on abort.
        if (abortController.signal.aborted) {
            updateInputBox(commitText, true)
            break
        }

        // Update the input box value based on the message type.
        switch (message.type) {
            case 'change':
                commitText = message.text
                typewriter.update(commitText)
                break
            case 'complete':
                typewriter.close()
                progress.report({ message: 'Complete' })
                break
            case 'error':
                typewriter.close()
                throw new Error(message?.error?.message)
        }
    }
}
