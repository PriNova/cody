import type { Action, ChatMessage, Model } from '@sourcegraph/cody-shared'
import { useExtensionAPI } from '@sourcegraph/prompt-editor'
import clsx from 'clsx'
import { type FunctionComponent, useCallback } from 'react'
import type { UserAccountInfo } from '../../../../../../Chat'
import { ModelSelectField } from '../../../../../../components/modelSelectField/ModelSelectField'
import { PromptSelectField } from '../../../../../../components/promptSelectField/PromptSelectField'
import { Checkbox } from '../../../../../../components/shadcn/ui/checkbox'
import toolbarStyles from '../../../../../../components/shadcn/ui/toolbar.module.css'
import { useActionSelect } from '../../../../../../prompts/PromptsTab'
import { isGeminiFlash2Model } from '../../../../../../utils/modelUtils'
import { useClientConfig } from '../../../../../../utils/useClientConfig'
import { AddContextButton } from './AddContextButton'
import { SubmitButton, type SubmitButtonState } from './SubmitButton'
import { TokenDisplay } from './TokenDisplay'
import { UploadImageButton } from './UploadImageButton'

/**
 * The toolbar for the human message editor.
 */
export const Toolbar: FunctionComponent<{
    models: Model[]
    userInfo: UserAccountInfo

    isEditorFocused: boolean

    onMentionClick?: () => void

    onSubmitClick: (intent?: ChatMessage['intent']) => void
    submitState: SubmitButtonState

    /** Handler for clicks that are in the "gap" (dead space), not any toolbar items. */
    onGapClick?: () => void

    focusEditor?: () => void

    hidden?: boolean
    className?: string
    intent?: ChatMessage['intent']
    tokenCount?: number
    contextWindow?: number
    transcriptTokens?: number
    isLastInteraction?: boolean
    imageFile?: File
    setImageFile: (file: File | undefined) => void
    isGoogleSearchEnabled: boolean
    setIsGoogleSearchEnabled: (value: boolean) => void
}> = ({
    userInfo,
    isEditorFocused,
    onMentionClick,
    onSubmitClick,
    submitState,
    onGapClick,
    focusEditor,
    hidden,
    className,
    models,
    intent,
    tokenCount,
    contextWindow,
    transcriptTokens,
    isLastInteraction,
    imageFile,
    setImageFile,
    isGoogleSearchEnabled,
    setIsGoogleSearchEnabled,
}) => {
    /**
     * If the user clicks in a gap or on the toolbar outside of any of its buttons, report back to
     * parent via {@link onGapClick}.
     */
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

    const isGoogleModel = useCallback((model: Model) => {
        return isGeminiFlash2Model(model)
    }, [])

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only relevant to click areas
        <menu
            role="toolbar"
            aria-hidden={hidden}
            hidden={hidden}
            className={clsx(
                'tw-flex tw-items-center tw-justify-between tw-flex-wrap-reverse tw-border-t tw-border-t-border tw-gap-2 [&_>_*]:tw-flex-shrink-0',
                className
            )}
            onMouseDown={onMaybeGapClick}
            onClick={onMaybeGapClick}
            data-testid="chat-editor-toolbar"
        >
            <div className="tw-flex tw-items-center">
                {/* Can't use tw-gap-1 because the popover creates an empty element when open. */}
                {isGoogleModel(models[0]) && (
                    <UploadImageButton
                        className="tw-opacity-60"
                        imageFile={imageFile}
                        onClick={setImageFile}
                    />
                )}
                {onMentionClick && (
                    <AddContextButton
                        onClick={onMentionClick}
                        className={`tw-opacity-60 focus-visible:tw-opacity-100 hover:tw-opacity-100 tw-mr-2 tw-gap-0.5 ${toolbarStyles.button} ${toolbarStyles.buttonSmallIcon}`}
                    />
                )}
                <PromptSelectFieldToolbarItem focusEditor={focusEditor} className="tw-ml-1 tw-mr-1" />
                <ModelSelectFieldToolbarItem
                    models={models}
                    userInfo={userInfo}
                    focusEditor={focusEditor}
                    className="tw-mr-1"
                    supportsImageUpload={isGoogleModel(models[0])}
                />

                {tokenCount !== undefined &&
                    contextWindow &&
                    transcriptTokens !== undefined &&
                    isLastInteraction && (
                        <TokenDisplay
                            current={tokenCount}
                            total={transcriptTokens}
                            limit={contextWindow}
                        />
                    )}
            </div>
            <div className="tw-flex tw-items-center tw-gap-2">
                {isGoogleModel(models[0]) && (
                    <div className="tw-flex tw-items-center">
                        <Checkbox
                            id="google-search-toggle"
                            checked={isGoogleSearchEnabled}
                            onCheckedChange={setIsGoogleSearchEnabled}
                        />
                        <label
                            htmlFor="google-search-toggle"
                            className="tw-text-sm tw-text-secondary-foreground tw-ml-1 tw-cursor-pointer"
                        >
                            Google Search
                        </label>
                    </div>
                )}
                <div className="tw-flex-1 tw-flex tw-justify-end">
                    <SubmitButton
                        onClick={onSubmitClick}
                        isEditorFocused={isEditorFocused}
                        state={submitState}
                        detectedIntent={intent}
                    />
                </div>
            </div>
        </menu>
    )
}

const PromptSelectFieldToolbarItem: FunctionComponent<{
    focusEditor?: () => void
    className?: string
}> = ({ focusEditor, className }) => {
    const runAction = useActionSelect()

    const onSelect = useCallback(
        async (item: Action) => {
            await runAction(item, () => {})
            focusEditor?.()
        },
        [focusEditor, runAction]
    )

    return <PromptSelectField onSelect={onSelect} onCloseByEscape={focusEditor} className={className} />
}

const ModelSelectFieldToolbarItem: FunctionComponent<{
    models: Model[]
    userInfo: UserAccountInfo
    focusEditor?: () => void
    className?: string
    supportsImageUpload?: boolean
}> = ({ userInfo, focusEditor, className, models, supportsImageUpload }) => {
    const clientConfig = useClientConfig()
    const serverSentModelsEnabled = !!clientConfig?.modelsAPIEnabled

    const api = useExtensionAPI()

    const onModelSelect = useCallback(
        (model: Model) => {
            api.setChatModel(model.id).subscribe({
                error: error => console.error('setChatModel:', error),
            })
            focusEditor?.()
        },
        [api.setChatModel, focusEditor]
    )

    return (
        !!models?.length &&
        (userInfo.isDotComUser || serverSentModelsEnabled) && (
            <ModelSelectField
                models={models}
                onModelSelect={onModelSelect}
                serverSentModelsEnabled={serverSentModelsEnabled}
                userInfo={userInfo}
                onCloseByEscape={focusEditor}
                className={className}
                data-testid="chat-model-selector"
            />
        )
    )
}
