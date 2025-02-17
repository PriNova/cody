import { type Guardrails, type PromptString, isError } from '@sourcegraph/cody-shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clsx } from 'clsx'
import { URI } from 'vscode-uri'
import type { FixupTaskID } from '../../../src/non-stop/FixupTask'
import { CodyTaskState } from '../../../src/non-stop/state'
import { type ClientActionListener, useClientActionListener } from '../../client/clientState'
import { MarkdownFromCody } from '../../components/MarkdownFromCody'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '../../components/shadcn/ui/accordion'
import { getVSCodeAPI } from '../../utils/VSCodeApi'
import { useConfig } from '../../utils/useConfig'
import type { PriorHumanMessageInfo } from '../cells/messageCell/assistant/AssistantMessageCell'
import styles from './ChatMessageContent.module.css'
import { GuardrailsStatusController } from './GuardRailStatusController'
import { createButtons, createButtonsExperimentalUI } from './create-buttons'
import { getCodeBlockId, getFileName } from './utils'

export interface CodeBlockActionsProps {
    copyButtonOnSubmit: (text: string, event?: 'Keydown' | 'Button') => void
    insertButtonOnSubmit: (text: string, newFile?: boolean) => void
    smartApply: {
        onSubmit: (id: string, text: string, instruction?: PromptString, fileName?: string) => void
        onAccept: (id: string) => void
        onReject: (id: string) => void
    }
}

interface ChatMessageContentProps {
    displayMarkdown: string
    isMessageLoading: boolean
    humanMessage: PriorHumanMessageInfo | null

    copyButtonOnSubmit?: CodeBlockActionsProps['copyButtonOnSubmit']
    insertButtonOnSubmit?: CodeBlockActionsProps['insertButtonOnSubmit']

    smartApplyEnabled?: boolean
    smartApply?: CodeBlockActionsProps['smartApply']

    guardrails?: Guardrails
    className?: string
}

/**
 * A component presenting the content of a chat message.
 */
export const ChatMessageContent: React.FunctionComponent<ChatMessageContentProps> = ({
    displayMarkdown,
    isMessageLoading,
    humanMessage,
    copyButtonOnSubmit,
    insertButtonOnSubmit,
    guardrails,
    className,
    smartApplyEnabled,
    smartApply,
}) => {
    const rootRef = useRef<HTMLDivElement>(null)
    const config = useConfig()
    const [textContent, setTextContent] = useState<string>(displayMarkdown)
    const [textareas, setTextareas] = useState<JSX.Element[]>([])

    const [smartApplyStates, setSmartApplyStates] = useState<Record<FixupTaskID, CodyTaskState>>({})
    const smartApplyInterceptor = useMemo<CodeBlockActionsProps['smartApply'] | undefined>(() => {
        if (!smartApply) {
            return
        }

        return {
            ...smartApply,
            onSubmit(id, text, instruction, fileName) {
                // We intercept the `onSubmit` to mark this task as working as early as we can.
                // In reality, this will happen once we determine the task selection and _then_ start the task.
                // The user does not need to be aware of this, for their purposes this is a single operation.
                // We can re-use the `Working` state to simplify our UI logic.
                setSmartApplyStates(prev => ({ ...prev, [id]: CodyTaskState.Working }))
                return smartApply.onSubmit(id, text, instruction, fileName)
            },
        }
    }, [smartApply])

    useClientActionListener(
        // Always subscribe but listen only smart apply result events
        { isActive: true, selector: event => !!event.smartApplyResult },
        useCallback<ClientActionListener>(({ smartApplyResult }) => {
            if (smartApplyResult) {
                setSmartApplyStates(prev => ({
                    ...prev,
                    [smartApplyResult.taskId]: smartApplyResult.taskState,
                }))
            }
        }, [])
    )

    useEffect(() => {
        const parts: string[] = []
        const textareaElements: JSX.Element[] = []
        let lastIndex = 0

        // Match opening thinking tags immediately
        const matches = [...displayMarkdown.matchAll(/<think7345>/g)]

        for (const match of matches) {
            const startIndex = match.index!
            const endIndex = displayMarkdown.indexOf('</think7345>', startIndex)
            const thinkingContent =
                endIndex !== -1
                    ? displayMarkdown.slice(startIndex + '<think7345>'.length, endIndex)
                    : displayMarkdown.slice(startIndex + '<think7345>'.length)

            parts.push(displayMarkdown.slice(lastIndex, startIndex))
            textareaElements.push(
                <div key={`thinking-${startIndex}`} className={styles.thinkingContainer}>
                    <Accordion type="single" collapsible defaultValue="thinking">
                        <AccordionItem value="thinking">
                            <AccordionTrigger className={styles.thinkingTitle}>
                                Thinking Process
                            </AccordionTrigger>
                            <AccordionContent className="accordion-content">
                                <MarkdownFromCody className={styles.content}>
                                    {thinkingContent}
                                </MarkdownFromCody>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </div>
            )
            lastIndex = endIndex !== -1 ? endIndex + '</think7345>'.length : displayMarkdown.length
        }

        parts.push(displayMarkdown.slice(lastIndex))
        setTextContent(parts.join(''))
        setTextareas(textareaElements)
    }, [displayMarkdown])

    // See SRCH-942: this `useEffect` is very large and any update to the
    // dependencies triggers a network request to our guardrails server. Be very
    // careful about adding more dependencies.  Ideally, we should refactor this
    // `useEffect` into smaller blocks with more narrow dependencies.
    // biome-ignore lint/correctness/useExhaustiveDependencies: needs to run when `displayMarkdown` changes or else the buttons won't show up.
    useEffect(() => {
        if (!rootRef.current) {
            return
        }

        const preElements = rootRef.current.querySelectorAll('pre')
        if (!preElements?.length || !copyButtonOnSubmit) {
            return
        }

        const existingButtons = rootRef.current.querySelectorAll(`.${styles.buttonsContainer}`)
        for (const existingButton of existingButtons) {
            existingButton.remove()
        }

        for (const preElement of preElements) {
            const preText = preElement.textContent

            if (preText?.trim() && preElement.parentNode) {
                // Extract the <code> element and attached `data-file-path` if present.
                // This allows us to intelligently apply code to the suitable file.
                const codeElement = preElement.querySelectorAll('code')?.[0]
                const fileName = codeElement?.getAttribute('data-file-path') || undefined
                // Check if the code element has either 'language-bash' or 'language-shell' class
                const isShellCommand =
                    codeElement?.classList.contains('language-bash') ||
                    codeElement?.classList.contains('language-shell')
                const codeBlockName = isShellCommand ? 'command' : fileName

                let buttons: HTMLElement

                if (smartApplyEnabled) {
                    const smartApplyId = getCodeBlockId(preText, fileName)
                    const smartApplyState = smartApplyStates[smartApplyId]
                    buttons = createButtonsExperimentalUI(
                        preText,
                        humanMessage,
                        config,
                        codeBlockName,
                        copyButtonOnSubmit,
                        config.config.hasEditCapability ? insertButtonOnSubmit : undefined,
                        smartApplyInterceptor,
                        smartApplyId,
                        smartApplyState
                    )
                } else {
                    buttons = createButtons(
                        preText,
                        copyButtonOnSubmit,
                        config.config.hasEditCapability ? insertButtonOnSubmit : undefined
                    )
                }

                const metadataContainer = document.createElement('div')
                metadataContainer.classList.add(styles.metadataContainer)
                buttons.append(metadataContainer)

                if (guardrails) {
                    const container = document.createElement('div')
                    container.classList.add(styles.attributionContainer)
                    metadataContainer.append(container)

                    if (!isMessageLoading) {
                        const g = new GuardrailsStatusController(container)
                        g.setPending()

                        guardrails
                            .searchAttribution(preText)
                            .then(attribution => {
                                if (isError(attribution)) {
                                    g.setUnavailable(attribution)
                                } else if (attribution.repositories.length === 0) {
                                    g.setSuccess()
                                } else {
                                    g.setFailure(
                                        attribution.repositories.map(r => r.name),
                                        attribution.limitHit
                                    )
                                }
                            })
                            .catch(error => {
                                g.setUnavailable(error)
                                return
                            })
                    }
                }

                if (fileName) {
                    const fileNameContainer = document.createElement('div')
                    fileNameContainer.className = clsx(styles.fileNameContainer, styles.clickable)
                    fileNameContainer.textContent = getFileName(fileName)
                    fileNameContainer.title = fileName

                    fileNameContainer.addEventListener('click', () => {
                        // Get workspace URI attributes from document root
                        const uri = URI.file(fileName)
                        getVSCodeAPI().postMessage({
                            command: 'openRelativeFile',
                            uri: uri,
                        })
                    })

                    metadataContainer.append(fileNameContainer)
                }

                // Insert the buttons after the pre using insertBefore() because there is no insertAfter()
                preElement.parentNode.insertBefore(buttons, preElement.nextSibling)
            }
        }
    }, [
        copyButtonOnSubmit,
        insertButtonOnSubmit,
        smartApplyEnabled,
        guardrails,
        displayMarkdown,
        isMessageLoading,
        humanMessage,
        smartApplyInterceptor,
        smartApplyStates,
    ])

    return (
        <div ref={rootRef} data-testid="chat-message-content">
            {textareas}
            <MarkdownFromCody className={clsx(styles.content, className)}>
                {textContent}
            </MarkdownFromCody>
        </div>
    )
}
