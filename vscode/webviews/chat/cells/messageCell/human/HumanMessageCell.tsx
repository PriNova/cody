import {
    type ChatMessage,
    type Model,
    type SerializedPromptEditorState,
    type SerializedPromptEditorValue,
    serializedPromptEditorStateFromChatMessage,
} from '@sourcegraph/cody-shared'
import type { PromptEditorRefAPI } from '@sourcegraph/prompt-editor'
import clsx from 'clsx'
import isEqual from 'lodash/isEqual'
import { type FC, memo, useMemo, useRef, useState } from 'react'
import type { UserAccountInfo } from '../../../../Chat'
import { BaseMessageCell } from '../BaseMessageCell'
import { HumanMessageEditor } from './editor/HumanMessageEditor'
interface HumanMessageCellProps {
    message: ChatMessage
    models: Model[]
    userInfo: UserAccountInfo
    chatEnabled: boolean
    isFirstMessage: boolean
    isSent: boolean
    isPendingPriorResponse: boolean
    onEditorFocusChange?: (focused: boolean) => void
    onChange?: (editorState: SerializedPromptEditorValue) => void
    onSubmit: (intent?: ChatMessage['intent']) => void
    onStop: () => void
    isFirstInteraction?: boolean
    isLastInteraction?: boolean
    isEditorInitiallyFocused?: boolean
    className?: string
    editorRef?: React.RefObject<PromptEditorRefAPI | null>

    intent: ChatMessage['intent']
    manuallySelectIntent: (intent: ChatMessage['intent']) => void

    /** For use in storybooks only. */
    __storybook__focus?: boolean
    transcriptTokens?: number
    isGoogleSearchEnabled: boolean
    setIsGoogleSearchEnabled: (enabled: boolean) => void
    onTokenCountChange?: (count: number) => void
}

export const HumanMessageCell: FC<HumanMessageCellProps> = ({
    message,
    onTokenCountChange,
    ...otherProps
}) => {
    // Don't render the editor if the message text is explicitly undefined or empty,
    // and it's been sent already and it's not the last interaction (i.e. there is a tool result response).
    if (
        (message.text === undefined || (message.text && message.text.length === 0)) &&
        otherProps.isSent &&
        !otherProps.isLastInteraction &&
        message.intent === 'agentic'
    ) {
        return null
    }

    const messageJSON = JSON.stringify(message)
    const initialEditorState = useMemo(
        () => serializedPromptEditorStateFromChatMessage(JSON.parse(messageJSON)),
        [messageJSON]
    )
    const [imageFile, setImageFile] = useState<File | undefined>()

    return (
        <HumanMessageCellContent
            {...otherProps}
            initialEditorState={initialEditorState}
            imageFile={imageFile}
            setImageFile={setImageFile}
            onTokenCountChange={onTokenCountChange}
        />
    )
}

type HumanMessageCellContent = {
    initialEditorState: SerializedPromptEditorState
    imageFile?: File
    setImageFile: (file: File | undefined) => void
    isGoogleSearchEnabled: boolean
    setIsGoogleSearchEnabled: (enabled: boolean) => void
    onTokenCountChange?: (count: number) => void
} & Omit<HumanMessageCellProps, 'message'>

const HumanMessageCellContent = memo<HumanMessageCellContent>(props => {
    const {
        models,
        initialEditorState,
        userInfo,
        chatEnabled = true,
        isFirstMessage,
        isSent,
        isPendingPriorResponse,
        onChange,
        onSubmit,
        onStop,
        isFirstInteraction,
        isLastInteraction,
        isEditorInitiallyFocused,
        className,
        editorRef,
        __storybook__focus,
        onEditorFocusChange,
        intent,
        manuallySelectIntent,
        imageFile,
        isGoogleSearchEnabled,
        setIsGoogleSearchEnabled,
        setImageFile,
        onTokenCountChange,
    } = props
    const [isDragging, setIsDragging] = useState(false)
    const dragCounter = useRef(0)

    const resetDragState = () => {
        dragCounter.current = 0
        setIsDragging(false)
    }

    const handleDragEnter = (event: React.DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        dragCounter.current += 1
        const items = Array.from(event.dataTransfer.items)
        if (items.some(item => item.type.startsWith('image/'))) {
            setIsDragging(true)
        }
    }

    const handleDragLeave = (event: React.DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        dragCounter.current -= 1
        if (dragCounter.current === 0) {
            setIsDragging(false)
        }
    }

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        setIsDragging(false)

        const file = event.dataTransfer.files[0]
        if (file?.type.startsWith('image/')) {
            props.setImageFile(file)
            props.editorRef?.current?.setFocus(true)
        }
    }

    const handleDragOver = (event: React.DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
    }

    const handleDragEnd = () => {
        resetDragState()
    }

    return (
        <BaseMessageCell
            content={
                <div
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    className={clsx({
                        'tw-border-2 tw-border-dashed tw-border-focusBorder tw-rounded-md': isDragging,
                    })}
                >
                    <HumanMessageEditor
                        models={models}
                        userInfo={userInfo}
                        initialEditorState={initialEditorState}
                        placeholder={
                            isFirstMessage
                                ? 'Ask anything. Use @ to specify context...'
                                : 'Use @ to add more context...'
                        }
                        isFirstMessage={isFirstMessage}
                        isSent={isSent}
                        isPendingPriorResponse={isPendingPriorResponse}
                        onChange={onChange}
                        onSubmit={onSubmit}
                        onStop={onStop}
                        disabled={!chatEnabled}
                        isFirstInteraction={isFirstInteraction}
                        isLastInteraction={isLastInteraction}
                        isEditorInitiallyFocused={isEditorInitiallyFocused}
                        editorRef={editorRef}
                        __storybook__focus={__storybook__focus}
                        onEditorFocusChange={onEditorFocusChange}
                        intent={intent}
                        manuallySelectIntent={manuallySelectIntent}
                        imageFile={imageFile}
                        setImageFile={setImageFile}
                        isGoogleSearchEnabled={isGoogleSearchEnabled}
                        setIsGoogleSearchEnabled={setIsGoogleSearchEnabled}
                        onTokenCountChange={onTokenCountChange}
                    />
                </div>
            }
            className={className}
        />
    )
}, isEqual)
