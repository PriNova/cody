import type { Context } from '@opentelemetry/api'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
    type AuthenticatedAuthStatus,
    type ChatMessage,
    CodyIDE,
    FAST_CHAT_INPUT_TOKEN_BUDGET,
    type Guardrails,
    type Model,
    type PromptString,
} from '@sourcegraph/cody-shared'

import styles from './Chat.module.css'
import { Transcript, focusLastHumanMessageEditor } from './chat/Transcript'
import { WelcomeMessage } from './chat/components/WelcomeMessage'
import { WelcomeNotice } from './chat/components/WelcomeNotice'
import { ScrollDown } from './components/ScrollDown'
import { TokenCounterFooter } from './components/TokenCounterFooter'
import { useLocalStorage } from './components/hooks'
import type { View } from './tabs'
import type { VSCodeWrapper } from './utils/VSCodeApi'
import { SpanManager } from './utils/spanManager'
import { getTraceparentFromSpanContext } from './utils/telemetry'
import { useUserAccountInfo } from './utils/useConfig'

interface ChatboxProps {
    chatEnabled: boolean
    messageInProgress: ChatMessage | null
    transcript: ChatMessage[]
    models: Model[]
    vscodeAPI: Pick<VSCodeWrapper, 'postMessage' | 'onMessage'>
    guardrails: Guardrails
    scrollableParent?: HTMLElement | null
    showWelcomeMessage?: boolean
    showIDESnippetActions?: boolean
    setView: (view: View) => void
    isWorkspacesUpgradeCtaEnabled?: boolean
}

const LAST_SELECTED_INTENT_KEY = 'last-selected-intent'

export const Chat: React.FunctionComponent<React.PropsWithChildren<ChatboxProps>> = ({
    messageInProgress,
    transcript,
    models,
    vscodeAPI,
    chatEnabled = true,
    guardrails,
    scrollableParent,
    showWelcomeMessage = true,
    showIDESnippetActions = true,
    setView,
    isWorkspacesUpgradeCtaEnabled,
}) => {
    const transcriptRef = useRef(transcript)
    transcriptRef.current = transcript

    const userInfo = useUserAccountInfo()
    const [lastManuallySelectedIntent, setLastManuallySelectedIntent] = useLocalStorage<
        ChatMessage['intent']
    >(LAST_SELECTED_INTENT_KEY, 'chat')

    const copyButtonOnSubmit = useCallback(
        (text: string, eventType: 'Button' | 'Keydown' = 'Button') => {
            const op = 'copy'
            // remove the additional newline added by the text area at the end of the text

            const code = eventType === 'Button' ? text.replace(/\n$/, '') : text
            // Log the event type and text to telemetry in chat view

            vscodeAPI.postMessage({
                command: op,
                eventType,
                text: code,
            })
        },
        [vscodeAPI]
    )

    const insertButtonOnSubmit = useMemo(() => {
        if (showIDESnippetActions) {
            return (text: string, newFile = false) => {
                const op = newFile ? 'newFile' : 'insert'
                // Log the event type and text to telemetry in chat view

                vscodeAPI.postMessage({
                    command: op,
                    // remove the additional /n added by the text area at the end of the text
                    text: text.replace(/\n$/, ''),
                })
            }
        }

        return
    }, [vscodeAPI, showIDESnippetActions])

    const smartApply = useMemo(() => {
        if (!showIDESnippetActions) {
            return
        }

        function onSubmit({
            id,
            text,
            instruction,
            fileName,
            isPrefetch,
        }: {
            id: string
            text: string
            isPrefetch?: boolean
            instruction?: PromptString
            fileName?: string
        }) {
            const command = isPrefetch ? 'smartApplyPrefetch' : 'smartApplySubmit'

            const spanManager = new SpanManager('cody-webview')
            const span = spanManager.startSpan(command, {
                attributes: {
                    sampled: true,
                    'smartApply.id': id,
                },
            })
            const traceparent = getTraceparentFromSpanContext(span.spanContext())

            vscodeAPI.postMessage({
                command,
                id,
                instruction: instruction?.toString(),
                // remove the additional /n added by the text area at the end of the text
                code: text.replace(/\n$/, ''),
                fileName,
                traceparent,
            })
            span.end()
        }

        return {
            onSubmit,
            onAccept: (id: string) => {
                vscodeAPI.postMessage({
                    command: 'smartApplyAccept',
                    id,
                })
            },
            onReject: (id: string) => {
                vscodeAPI.postMessage({
                    command: 'smartApplyReject',
                    id,
                })
            },
        }
    }, [vscodeAPI, showIDESnippetActions])

    const postMessage = useCallback<ApiPostMessage>(msg => vscodeAPI.postMessage(msg), [vscodeAPI])

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            // Esc to abort the message in progress.
            if (event.key === 'Escape' && messageInProgress) {
                vscodeAPI.postMessage({ command: 'abort' })
            }

            // NOTE(sqs): I have a keybinding on my Linux machine Super+o to switch VS Code editor
            // groups. This makes it so that that keybinding does not also input the letter 'o'.
            // This is a workaround for (arguably) a VS Code issue.
            if (event.metaKey && event.key === 'o') {
                event.preventDefault()
                event.stopPropagation()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [vscodeAPI, messageInProgress])

    // Re-focus the input when the webview (re)gains focus if it was focused before the webview lost
    // focus. This makes it so that the user can easily switch back to the Cody view and keep
    // typing.
    useEffect(() => {
        const onFocus = (): void => {
            // This works because for some reason Electron maintains the Selection but not the
            // focus.
            const sel = window.getSelection()
            const focusNode = sel?.focusNode
            const focusElement = focusNode instanceof Element ? focusNode : focusNode?.parentElement
            const focusEditor = focusElement?.closest<HTMLElement>('[data-lexical-editor="true"]')
            if (focusEditor) {
                focusEditor.focus({ preventScroll: true })
            }
        }
        window.addEventListener('focus', onFocus)
        return () => {
            window.removeEventListener('focus', onFocus)
        }
    }, [])

    const handleScrollDownClick = useCallback(() => {
        // Scroll to the bottom instead of focus input for unsent message
        // it's possible that we just want to scroll to the bottom in case of
        // welcome message screen
        if (transcript.length === 0) {
            return
        }

        focusLastHumanMessageEditor()
    }, [transcript])
    const [activeChatContext, setActiveChatContext] = useState<Context>()

    const [isGoogleSearchEnabled, setIsGoogleSearchEnabled] = useState(false)

    const [tokenCounts, setTokenCounts] = useState<{ currentTokens: number; transcriptTokens: number }>({
        currentTokens: 0,
        transcriptTokens: 0,
    })

    // Get the context window size from the current model
    const contextWindowSize = useMemo(() => {
        const currentModel = models?.[0]
        return (
            (currentModel?.contextWindow?.context?.user || 0) +
                (currentModel?.contextWindow?.input || 0) || FAST_CHAT_INPUT_TOKEN_BUDGET
        )
    }, [models])

    const handleTokenCountsChange = useCallback(
        (counts: { currentTokens: number; transcriptTokens: number }) => {
            setTokenCounts(counts)
        },
        []
    )

    useEffect(() => {
        if (transcript.length > 0) {
            // This will indirectly trigger token calculation in Transcript component
            // by causing it to re-render with the new transcript
            const timer = setTimeout(() => {
                // Force a re-render of the Transcript component
                setTokenCounts(current => ({ ...current }))
            }, 100)

            return () => clearTimeout(timer)
        }
        return undefined
    }, [transcript])

    return (
        <div className="tw-relative tw-flex tw-flex-col tw-h-full">
            {!chatEnabled && (
                <div className={styles.chatDisabled}>
                    Cody chat is disabled by your Sourcegraph site administrator
                </div>
            )}
            <div className="tw-flex-grow tw-overflow-auto">
                <Transcript
                    activeChatContext={activeChatContext}
                    setActiveChatContext={setActiveChatContext}
                    transcript={transcript}
                    models={models}
                    messageInProgress={messageInProgress}
                    copyButtonOnSubmit={copyButtonOnSubmit}
                    insertButtonOnSubmit={insertButtonOnSubmit}
                    smartApply={smartApply}
                    userInfo={userInfo}
                    chatEnabled={chatEnabled}
                    postMessage={postMessage}
                    guardrails={guardrails}
                    manuallySelectedIntent={
                        // Only allow 'search' intent for non-Pro and non-Free users
                        // The bug is that search intent was available for Pro and Free users
                        lastManuallySelectedIntent === 'search' &&
                        (userInfo.isCodyProUser || userInfo.isDotComUser)
                            ? 'chat'
                            : lastManuallySelectedIntent
                    }
                    setManuallySelectedIntent={intent => {
                        // Prevent setting 'search' intent for Pro and Free users
                        if (intent === 'search' && (userInfo.isCodyProUser || userInfo.isDotComUser)) {
                            setLastManuallySelectedIntent('chat')
                        } else {
                            setLastManuallySelectedIntent(intent)
                        }
                    }}
                    isGoogleSearchEnabled={isGoogleSearchEnabled}
                    setIsGoogleSearchEnabled={setIsGoogleSearchEnabled}
                    onTokenCountsChange={handleTokenCountsChange}
                />
                {transcript.length === 0 && showWelcomeMessage && (
                    <>
                        <WelcomeMessage IDE={userInfo.IDE} setView={setView} />
                        {isWorkspacesUpgradeCtaEnabled && userInfo.IDE !== CodyIDE.Web && (
                            <div className="tw-absolute tw-bottom-0 tw-left-1/2 tw-transform tw--translate-x-1/2 tw-w-[95%] tw-z-1 tw-mb-4 tw-max-h-1/2">
                                <WelcomeNotice />
                            </div>
                        )}
                    </>
                )}
                {scrollableParent && (
                    <ScrollDown scrollableParent={scrollableParent} onClick={handleScrollDownClick} />
                )}
            </div>

            {/* Add the token counter footer */}
            <TokenCounterFooter
                key={`token-footer-${tokenCounts.currentTokens}-${tokenCounts.transcriptTokens}`}
                currentTokens={tokenCounts.currentTokens}
                transcriptTokens={tokenCounts.transcriptTokens}
                contextWindow={contextWindowSize}
            />
        </div>
    )
}

export interface UserAccountInfo {
    isDotComUser: boolean
    isCodyProUser: boolean
    user: Pick<
        AuthenticatedAuthStatus,
        'username' | 'displayName' | 'avatarURL' | 'endpoint' | 'primaryEmail' | 'organizations'
    >
    IDE: CodyIDE
}

export type ApiPostMessage = (message: any) => void
