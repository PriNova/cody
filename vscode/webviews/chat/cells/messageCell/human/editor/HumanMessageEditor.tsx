import {
    type ChatMessage,
    type ContextItemMedia,
    FAST_CHAT_INPUT_TOKEN_BUDGET,
    type Model,
    ModelTag,
    type SerializedPromptEditorState,
    type SerializedPromptEditorValue,
    TokenCounterUtils,
    firstValueFrom,
    inputTextWithoutContextChipsFromPromptEditorState,
    skipPendingOperation,
    textContentFromSerializedLexicalNode,
} from '@sourcegraph/cody-shared'
import {
    ContextItemMentionNode,
    PromptEditor,
    type PromptEditorRefAPI,
    PromptEditorV2,
    useDefaultContextForChat,
    useExtensionAPI,
} from '@sourcegraph/prompt-editor'
import clsx from 'clsx'
import { debounce } from 'lodash'
import {
    type FocusEventHandler,
    type FunctionComponent,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react'
import type { UserAccountInfo } from '../../../../../Chat'
import { type ClientActionListener, useClientActionListener } from '../../../../../client/clientState'
import { promptModeToIntent } from '../../../../../prompts/promptUtils'
import { getVSCodeAPI } from '../../../../../utils/VSCodeApi'

import { useConfig } from '../../../../../utils/useConfig'
import { useLinkOpener } from '../../../../../utils/useLinkOpener'
import { useOmniBox } from '../../../../../utils/useOmniBox'
import styles from './HumanMessageEditor.module.css'
import type { SubmitButtonState } from './toolbar/SubmitButton'
import { Toolbar } from './toolbar/Toolbar'

/**
 * A component to compose and edit human chat messages and the settings associated with them.
 */
export const HumanMessageEditor: FunctionComponent<{
    models: Model[]
    userInfo: UserAccountInfo

    initialEditorState: SerializedPromptEditorState | undefined
    placeholder: string

    /** Whether this editor is for the first message (not a followup). */
    isFirstMessage: boolean

    /** Whether this editor is for a message that has been sent already. */
    isSent: boolean

    /** Whether this editor is for a followup message to a still-in-progress assistant response. */
    isPendingPriorResponse: boolean

    disabled?: boolean

    onEditorFocusChange?: (focused: boolean) => void
    onChange?: (editorState: SerializedPromptEditorValue) => void
    onSubmit: (intent?: ChatMessage['intent']) => void
    onStop: () => void

    isFirstInteraction?: boolean
    isLastInteraction?: boolean
    isEditorInitiallyFocused?: boolean
    className?: string

    editorRef?: React.RefObject<PromptEditorRefAPI | null>

    /** For use in storybooks only. */
    __storybook__focus?: boolean

    selectedIntent: ChatMessage['intent']
    manuallySelectIntent: (intent: ChatMessage['intent']) => void
    imageFile?: File
    setImageFile: (file: File | undefined) => void
    isGoogleSearchEnabled: boolean
    setIsGoogleSearchEnabled: (enabled: boolean) => void
    onTokenCountChange?: (count: number) => void
}> = ({
    models,
    userInfo,
    initialEditorState,
    placeholder,
    isFirstMessage,
    isSent,
    isPendingPriorResponse,
    disabled = false,
    onChange,
    onSubmit: parentOnSubmit,
    onStop,
    isLastInteraction,
    isEditorInitiallyFocused,
    className,
    editorRef: parentEditorRef,
    __storybook__focus,
    onEditorFocusChange: parentOnEditorFocusChange,
    selectedIntent,
    manuallySelectIntent,
    imageFile,
    setImageFile,
    isGoogleSearchEnabled,
    setIsGoogleSearchEnabled,
    onTokenCountChange,
}) => {
    const editorRef = useRef<PromptEditorRefAPI>(null)
    useImperativeHandle(parentEditorRef, (): PromptEditorRefAPI | null => editorRef.current)

    // The only PromptEditor state we really need to track in our own state is whether it's empty.
    const [isEmptyEditorValue, setIsEmptyEditorValue] = useState(
        initialEditorState
            ? textContentFromSerializedLexicalNode(initialEditorState.lexicalEditorState.root) === ''
            : true
    )
    // Keep the state variables
    const [tokenCount, setTokenCount] = useState<number>(0)
    const [tokenAdded, setTokenAdded] = useState<number>(0)

    // Create a single function to update token counts and notify parent
    const updateTokenCounts = useCallback(
        (textTokens: number, contextTokens: number) => {
            setTokenCount(textTokens)
            setTokenAdded(contextTokens)
            onTokenCountChange?.(textTokens + contextTokens)
        },
        [onTokenCountChange]
    )

    // Simplified token counter utility
    const tokenCounter = useMemo(async () => TokenCounterUtils, [])

    // Create a single debounced function for text tokens
    const debouncedCountText = useMemo(
        () =>
            debounce(async (text: string, contextTokens: number) => {
                const counter = await tokenCounter
                const count = (await counter.encode(text)).length
                updateTokenCounts(count, contextTokens)
            }, 300),
        [tokenCounter, updateTokenCounts]
    )

    // Single effect to handle context item token counting
    useEffect(() => {
        const editor = editorRef.current
        if (!editor) {
            return
        }

        // Calculate context tokens and update state
        const calculateContextTokens = () => {
            const value = editor.getSerializedValue()
            const items = value.contextItems
            if (!items?.length) {
                // Only update context tokens to 0, keep the existing text tokens
                updateTokenCounts(tokenCount, 0)
                return
            }

            const contextTokens = items.reduce(
                (acc, item) => acc + (!item.isTooLarge && !item.isIgnored && item.size ? item.size : 0),
                0
            )

            // Get text without context mentions
            const pureText = inputTextWithoutContextChipsFromPromptEditorState(value.editorState)
            debouncedCountText(pureText, contextTokens)
        }

        // Initial calculation
        calculateContextTokens()

        // Set up listener for context item changes
        const unregister = editor.registerMutationListener(ContextItemMentionNode, () => {
            calculateContextTokens()
        })

        return unregister
    }, [debouncedCountText, tokenCount, updateTokenCounts])

    const submitState: SubmitButtonState = isPendingPriorResponse
        ? 'waitingResponseComplete'
        : isEmptyEditorValue
          ? 'emptyEditorValue'
          : 'submittable'

    const onSubmitClick = useCallback(
        (_intent: ChatMessage['intent'], forceSubmit?: boolean): void => {
            if (!forceSubmit && submitState === 'emptyEditorValue') {
                return
            }

            if (!forceSubmit && submitState === 'waitingResponseComplete') {
                onStop()
                return
            }

            if (!editorRef.current) {
                throw new Error('No editorRef')
            }

            const processImage = async () => {
                if (imageFile) {
                    const readFileGetBase64String = (file: File): Promise<string> => {
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader()
                            reader.onload = () => {
                                const base64 = reader.result
                                if (base64 && typeof base64 === 'string') {
                                    resolve(base64.split(',')[1])
                                } else {
                                    reject(new Error('Failed to read file'))
                                }
                            }
                            reader.onerror = () => reject(new Error('Failed to read file'))
                            reader.readAsDataURL(file)
                        })
                    }

                    const base64 = await readFileGetBase64String(imageFile)
                    getVSCodeAPI().postMessage({
                        command: 'chat/upload-image',
                        image: base64,
                    })
                }
            }
            setImageFile(undefined)
            processImage()
            const processGoogleSearch = async () => {
                if (isGoogleSearchEnabled) {
                    getVSCodeAPI().postMessage({
                        command: 'chat/google-search',
                    })
                }
            }
            processGoogleSearch()

            parentOnSubmit(_intent)
        },
        [submitState, parentOnSubmit, onStop, imageFile, setImageFile, isGoogleSearchEnabled]
    )

    const omniBoxEnabled = useOmniBox() && !userInfo.isDotComUser
    const {
        config: { experimentalPromptEditorEnabled },
    } = useConfig()

    const onEditorEnterKey = useCallback(
        (event: KeyboardEvent | null): void => {
            // Submit input on Enter press (without shift) when input is not empty.
            if (!event || event.isComposing || isEmptyEditorValue || event.shiftKey) {
                return
            }
            event.preventDefault()
            onSubmitClick(selectedIntent)
        },
        [isEmptyEditorValue, onSubmitClick, selectedIntent]
    )

    const [isEditorFocused, setIsEditorFocused] = useState(false)
    const onEditorFocusChange = useCallback(
        (focused: boolean): void => {
            setIsEditorFocused(focused)
            parentOnEditorFocusChange?.(focused)
        },
        [parentOnEditorFocusChange]
    )

    const [isFocusWithin, setIsFocusWithin] = useState(false)
    const onFocus = useCallback(() => {
        setIsFocusWithin(true)
    }, [])
    const onBlur = useCallback<FocusEventHandler>(event => {
        // If we're shifting focus to one of our child elements, just skip this call because we'll
        // immediately set it back to true.
        const container = event.currentTarget as HTMLElement
        if (event.relatedTarget && container.contains(event.relatedTarget)) {
            return
        }

        setIsFocusWithin(false)
    }, [])

    useEffect(() => {
        if (isEditorInitiallyFocused) {
            // Only focus the editor if the user hasn't made another selection or has scrolled down.
            // It would be annoying if we clobber the user's intentional selection with the autofocus.
            const selection = window.getSelection()
            const userHasIntentionalSelection = selection && !selection.isCollapsed
            if (!userHasIntentionalSelection) {
                editorRef.current?.setFocus(true, { moveCursorToEnd: true })
                window.scrollTo({
                    top: window.document.body.scrollHeight,
                })
            }
        }
    }, [isEditorInitiallyFocused])

    /**
     * If the user clicks in a gap, focus the editor so that the whole component "feels" like an input field.
     */
    const onGapClick = useCallback(() => {
        editorRef.current?.setFocus(true, { moveCursorToEnd: true })
    }, [])
    const onMaybeGapClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            const targetIsToolbarButton = event.target !== event.currentTarget
            if (!targetIsToolbarButton) {
                event.preventDefault()
                event.stopPropagation()
                onGapClick?.()
            }
        },
        [onGapClick]
    )

    const extensionAPI = useExtensionAPI()

    // Set up the message listener so the extension can control the input field.
    useClientActionListener(
        // Add new context to chat from the "Cody Add Selection to Cody Chat"
        // command, etc. Only add to the last human input field.
        { isActive: !isSent },
        useCallback<ClientActionListener>(
            ({
                editorState,
                addContextItemsToLastHumanInput,
                appendTextToLastPromptEditor,
                submitHumanInput,
                setLastHumanInputIntent,
                setPromptAsInput,
            }) => {
                const updates: Promise<unknown>[] = []

                if (addContextItemsToLastHumanInput && addContextItemsToLastHumanInput.length > 0) {
                    const editor = editorRef.current
                    if (editor) {
                        updates.push(editor.addMentions(addContextItemsToLastHumanInput, 'after'))
                        updates.push(editor.setFocus(true))
                    }
                }

                if (appendTextToLastPromptEditor) {
                    // Schedule append text task to the next tick to avoid collisions with
                    // initial text set (add initial mentions first then append text from prompt)
                    updates.push(
                        new Promise<void>((resolve): void => {
                            requestAnimationFrame(() => {
                                if (editorRef.current) {
                                    editorRef.current
                                        .appendText(appendTextToLastPromptEditor)
                                        .then(resolve)
                                } else {
                                    resolve()
                                }
                            })
                        })
                    )
                }

                if (editorState) {
                    updates.push(
                        new Promise<void>(resolve => {
                            requestAnimationFrame(async () => {
                                if (editorRef.current) {
                                    await Promise.all([
                                        editorRef.current.setEditorState(editorState),
                                        editorRef.current.setFocus(true),
                                    ])
                                }
                                resolve()
                            })
                        })
                    )
                }

                let promptIntent: ChatMessage['intent'] = selectedIntent

                if (setPromptAsInput) {
                    // set the intent
                    promptIntent = promptModeToIntent(setPromptAsInput.mode)
                    manuallySelectIntent(promptIntent)

                    updates.push(
                        // biome-ignore lint/suspicious/noAsyncPromiseExecutor: <explanation>
                        new Promise<void>(async resolve => {
                            // get initial context
                            const { initialContext } = await firstValueFrom(
                                extensionAPI.defaultContext().pipe(skipPendingOperation())
                            )
                            // hydrate raw prompt text
                            const promptEditorState = await firstValueFrom(
                                extensionAPI.hydratePromptMessage(setPromptAsInput.text, initialContext)
                            )

                            // update editor state
                            requestAnimationFrame(async () => {
                                if (editorRef.current) {
                                    await Promise.all([
                                        editorRef.current.setEditorState(promptEditorState),
                                        editorRef.current.setFocus(true),
                                    ])
                                }
                                resolve()
                            })
                        })
                    )
                } else if (setLastHumanInputIntent) {
                    promptIntent = setLastHumanInputIntent
                    manuallySelectIntent(setLastHumanInputIntent)
                }

                if (submitHumanInput || setPromptAsInput?.autoSubmit) {
                    Promise.all(updates).then(() => onSubmitClick(promptIntent, true))
                }
            },
            [
                selectedIntent,
                onSubmitClick,
                extensionAPI.hydratePromptMessage,
                extensionAPI.defaultContext,
                manuallySelectIntent,
            ]
        )
    )

    const currentChatModel = useMemo(() => (models ? models[0] : undefined), [models, models?.[0]])

    const defaultContext = useDefaultContextForChat()

    useEffect(() => {
        if (isSent || !isFirstMessage || !editorRef?.current || selectedIntent === 'agentic') {
            return
        }

        // List of mention chips added to the first message.
        const editor = editorRef.current

        // Remove documentation open-link items; they do not provide context.
        // Remove current selection to avoid crowding the input box. User can always add it back.
        // Remove tree type if streaming is not supported.
        const excludedTypes = new Set([
            'open-link',
            ...(currentChatModel?.tags?.includes(ModelTag.StreamDisabled) ? ['tree'] : []),
        ])

        const filteredItems = defaultContext?.initialContext.filter(
            item => !excludedTypes.has(item.type)
        )
        void editor.setInitialContextMentions(filteredItems)
    }, [defaultContext?.initialContext, isSent, isFirstMessage, currentChatModel, selectedIntent])

    const focusEditor = useCallback(() => editorRef.current?.setFocus(true), [])

    useEffect(() => {
        if (__storybook__focus && editorRef.current) {
            setTimeout(() => focusEditor())
        }
    }, [__storybook__focus, focusEditor])

    const focused = Boolean(isEditorFocused || isFocusWithin || __storybook__focus)
    const contextWindowSizeInTokens =
        currentChatModel?.contextWindow?.context?.user ||
        currentChatModel?.contextWindow?.input ||
        FAST_CHAT_INPUT_TOKEN_BUDGET

    const linkOpener = useLinkOpener()
    const openExternalLink = useCallback(
        (uri: string) => linkOpener?.openExternalLink(uri),
        [linkOpener]
    )

    const Editor = experimentalPromptEditorEnabled ? PromptEditorV2 : PromptEditor

    const onMediaUpload = useCallback(
        (media: ContextItemMedia) => {
            // Add the media context item as a mention chip in the editor.
            const editor = editorRef?.current
            if (editor && focused) {
                editor.upsertMentions([media], 'after')
            }
        },
        [focused]
    )

    // Simplified editor change handler
    const onEditorChange = useCallback(
        async (value: SerializedPromptEditorValue): Promise<void> => {
            onChange?.(value)
            setIsEmptyEditorValue(!value?.text?.trim())

            // Get pure text without @-mentions
            const pureText = inputTextWithoutContextChipsFromPromptEditorState(value.editorState)

            // Calculate context tokens
            const contextTokens = value.contextItems.reduce(
                (acc, item) => acc + (!item.isTooLarge && !item.isIgnored && item.size ? item.size : 0),
                0
            )

            // Update token counts
            debouncedCountText(pureText, contextTokens)
        },
        [onChange, debouncedCountText]
    )

    // Calculate tokens on mount for initial editor state
    useEffect(() => {
        if (initialEditorState && onTokenCountChange) {
            const calculateInitialTokens = async () => {
                const counter = await tokenCounter
                const text = inputTextWithoutContextChipsFromPromptEditorState(initialEditorState)
                const textTokens = (await counter.encode(text)).length

                // For initial context tokens, we need to wait for the editor to be initialized
                // and then get the context items from there
                updateTokenCounts(textTokens, tokenAdded) // Initially set context tokens to 0

                // The context tokens will be updated when the editor is initialized and
                // the context items are added via the useEffect above
            }

            calculateInitialTokens()
        }
    }, [initialEditorState, tokenCounter, updateTokenCounts, onTokenCountChange, tokenAdded])

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only relevant to click areas
        <div
            className={clsx(
                styles.container,
                {
                    [styles.sent]: isSent,
                    [styles.focused]: focused,
                },
                'tw-transition',
                className
            )}
            data-keep-toolbar-open={isLastInteraction || undefined}
            onMouseDown={onMaybeGapClick}
            onClick={onMaybeGapClick}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            <Editor
                seamless={true}
                placeholder={placeholder}
                initialEditorState={initialEditorState}
                onChange={onEditorChange}
                onFocusChange={onEditorFocusChange}
                onEnterKey={onEditorEnterKey}
                editorRef={editorRef}
                disabled={disabled}
                contextWindowSizeInTokens={contextWindowSizeInTokens}
                editorClassName={styles.editor}
                contentEditableClassName={styles.editorContentEditable}
                openExternalLink={openExternalLink}
            />
            <Toolbar
                models={models}
                userInfo={userInfo}
                isEditorFocused={focused}
                omniBoxEnabled={omniBoxEnabled}
                onSubmitClick={onSubmitClick}
                submitState={submitState}
                onGapClick={onGapClick}
                focusEditor={focusEditor}
                hidden={!focused && isSent}
                className={styles.toolbar}
                intent={selectedIntent}
                isLastInteraction={isLastInteraction}
                imageFile={imageFile}
                setImageFile={setImageFile}
                isGoogleSearchEnabled={isGoogleSearchEnabled}
                setIsGoogleSearchEnabled={setIsGoogleSearchEnabled}
                extensionAPI={extensionAPI}
                onMediaUpload={onMediaUpload}
                setLastManuallySelectedIntent={manuallySelectIntent}
            />
        </div>
    )
}
