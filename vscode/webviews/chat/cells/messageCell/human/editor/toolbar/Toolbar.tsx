import type { WebviewToExtensionAPI } from '@sourcegraph/cody-shared'
import {
    type Action,
    type ChatMessage,
    type ContextItemMedia,
    type Model,
    ModelTag,
    //ModelTag,
    isMacOS,
} from '@sourcegraph/cody-shared'
import clsx from 'clsx'
import { type FunctionComponent, useCallback, useEffect, useMemo, useRef } from 'react'
import type { UserAccountInfo } from '../../../../../../Chat'
import { ModelSelectField } from '../../../../../../components/modelSelectField/ModelSelectField'
import { PromptSelectField } from '../../../../../../components/promptSelectField/PromptSelectField'
import { Checkbox } from '../../../../../../components/shadcn/ui/checkbox'
//import toolbarStyles from '../../../../../../components/shadcn/ui/toolbar.module.css'
import { useActionSelect } from '../../../../../../prompts/promptUtils'
import { useClientConfig } from '../../../../../../utils/useClientConfig'
//import { MediaUploadButton } from './MediaUploadButton'
import { ModeSelectorField } from './ModeSelectorButton'
import { SubmitButton, type SubmitButtonState } from './SubmitButton'
import { UploadImageButton } from './UploadImageButton'

/**
 * The toolbar for the human message editor.
 */
export const Toolbar: FunctionComponent<{
    models: Model[]
    userInfo: UserAccountInfo

    isEditorFocused: boolean

    onSubmitClick: (intent?: ChatMessage['intent']) => void
    submitState: SubmitButtonState

    /** Handler for clicks that are in the "gap" (dead space), not any toolbar items. */
    onGapClick?: () => void

    focusEditor?: () => void

    hidden?: boolean
    className?: string

    intent?: ChatMessage['intent']
    isLastInteraction?: boolean
    imageFile?: File
    setImageFile: (file: File | undefined) => void
    isGoogleSearchEnabled: boolean
    setIsGoogleSearchEnabled: (value: boolean) => void

    extensionAPI: WebviewToExtensionAPI

    omniBoxEnabled: boolean
    onMediaUpload?: (mediaContextItem: ContextItemMedia) => void

    setLastManuallySelectedIntent: (intent: ChatMessage['intent']) => void
}> = ({
    userInfo,
    isEditorFocused,
    onSubmitClick,
    submitState,
    onGapClick,
    focusEditor,
    hidden,
    className,
    models,
    intent,
    isLastInteraction,
    imageFile,
    setImageFile,
    isGoogleSearchEnabled,
    setIsGoogleSearchEnabled,
    extensionAPI,
    omniBoxEnabled,
    onMediaUpload,
    setLastManuallySelectedIntent,
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

    /**
     * Image upload is enabled if the user is not on Sourcegraph.com,
     * or is using a BYOK model with vision tag.
     */
    /* const isImageUploadEnabled = useMemo(() => {
        const isDotCom = userInfo?.isDotComUser
        const selectedModel = models?.[0]
        const isBYOK = selectedModel?.tags?.includes(ModelTag.BYOK)
        const isVision = selectedModel?.tags?.includes(ModelTag.Vision)
        return (!isDotCom || isBYOK) && isVision
    }, [userInfo?.isDotComUser, models?.[0]]) */

    const modelSelectorRef = useRef<{ open: () => void; close: () => void } | null>(null)
    const promptSelectorRef = useRef<{ open: () => void; close: () => void } | null>(null)

    // Set up keyboard event listener
    useEffect(() => {
        const handleKeyboardShortcuts = (event: KeyboardEvent) => {
            // Model selector (⌘M on Mac, ctrl+M on other platforms)
            // metaKey is set to cmd(⌘) on macOS, and windows key on other platforms
            if ((isMacOS() ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'm') {
                event.preventDefault()
                modelSelectorRef?.current?.open()
            }
            // Prompt selector (⌘/ on Mac, ctrl+/ on other platforms)
            else if ((isMacOS() ? event.metaKey : event.ctrlKey) && event.key === '/') {
                event.preventDefault()
                promptSelectorRef?.current?.open()
            }
            // Close dropdowns on Escape
            else if (event.key === 'Escape') {
                modelSelectorRef?.current?.close()
                promptSelectorRef?.current?.close()
            }
        }

        window.addEventListener('keydown', handleKeyboardShortcuts)
        return () => window.removeEventListener('keydown', handleKeyboardShortcuts)
    }, [])

    // TEMPORARY WORKAROUND: Add a fallback model if we only have 1 to ensure toolbar shows
    let modelsWithFallback: Model[] = models || []
    if (modelsWithFallback.length === 1) {
        const fallbackModel: Model = {
            ...modelsWithFallback[0],
            id: 'fallback/claude-3-5-sonnet-20241022' as any,
            title: 'Claude 3.5 Sonnet (Fallback)',
            tags: [ModelTag.BYOK],
        }
        modelsWithFallback = [...modelsWithFallback, fallbackModel]
    }

    if (modelsWithFallback.length < 2) {
        return null
    }

    return (
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
            onKeyDown={() => null}
            data-testid="chat-editor-toolbar"
        >
            <div className="tw-flex tw-items-center">
                {/* Can't use tw-gap-1 because the popover creates an empty element when open. */}
                {modelsWithFallback[0]?.clientSideConfig?.options?.googleImage && (
                    <UploadImageButton
                        className="tw-opacity-60"
                        imageFile={imageFile}
                        onClick={setImageFile}
                    />
                )}
                {/* {onMediaUpload && isImageUploadEnabled && (
                    <MediaUploadButton
                        onMediaUpload={onMediaUpload}
                        isEditorFocused={isEditorFocused}
                        submitState={submitState}
                        className={`tw-opacity-60 focus-visible:tw-opacity-100 hover:tw-opacity-100 tw-mr-2 tw-gap-0.5 ${toolbarStyles.button} ${toolbarStyles.buttonSmallIcon}`}
                    />
                )} */}
                <PromptSelectFieldToolbarItem
                    focusEditor={focusEditor}
                    className="tw-ml-1 tw-mr-1"
                    promptSelectorRef={promptSelectorRef}
                />
            </div>
            <div className="tw-flex tw-items-center tw-gap-2">
                {modelsWithFallback[0]?.clientSideConfig?.options?.googleSearch && (
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
                <ModeSelectorField
                    className={className}
                    omniBoxEnabled={omniBoxEnabled}
                    _intent={intent}
                    isDotComUser={userInfo?.isDotComUser}
                    isCodyProUser={userInfo?.isCodyProUser}
                    manuallySelectIntent={setLastManuallySelectedIntent}
                />
                <ModelSelectFieldToolbarItem
                    models={modelsWithFallback}
                    userInfo={userInfo}
                    focusEditor={focusEditor}
                    modelSelectorRef={modelSelectorRef}
                    className="tw-mr-1"
                    extensionAPI={extensionAPI}
                    intent={intent}
                />
            </div>
            <div className="tw-flex-1 tw-flex tw-justify-end">
                <SubmitButton onClick={onSubmitClick} state={submitState} />
            </div>
        </menu>
    )
}

const PromptSelectFieldToolbarItem: FunctionComponent<{
    focusEditor?: () => void
    className?: string
    promptSelectorRef?: React.MutableRefObject<{ open: () => void; close: () => void } | null>
}> = ({ focusEditor, className, promptSelectorRef }) => {
    const runAction = useActionSelect()

    const onSelect = useCallback(
        async (item: Action) => {
            await runAction(item, () => {})
            focusEditor?.()
        },
        [focusEditor, runAction]
    )

    return (
        <PromptSelectField
            onSelect={onSelect}
            onCloseByEscape={focusEditor}
            className={className}
            promptSelectorRef={promptSelectorRef}
        />
    )
}

const ModelSelectFieldToolbarItem: FunctionComponent<{
    models: Model[]
    userInfo: UserAccountInfo
    focusEditor?: () => void
    className?: string
    extensionAPI: WebviewToExtensionAPI
    modelSelectorRef: React.MutableRefObject<{ open: () => void; close: () => void } | null>
    intent?: ChatMessage['intent']
}> = ({ userInfo, focusEditor, className, models, extensionAPI, modelSelectorRef, intent }) => {
    const clientConfig = useClientConfig()
    const serverSentModelsEnabled = !!clientConfig?.modelsAPIEnabled

    const agenticModel = useMemo(
        () =>
            models.find(
                m =>
                    m.tags.includes(ModelTag.BYOK) &&
                    m.clientSideConfig?.options &&
                    'RPM' in m.clientSideConfig.options
            ),
        [models]
    )

    // If in agentic mode, ensure the agentic model is selected
    useEffect(() => {
        if (intent === 'agentic' && agenticModel /*&& models[0]?.id !== agenticModel.id*/) {
            extensionAPI.setChatModel(agenticModel.id).subscribe({
                error: error => console.error('Failed to set chat model:', error),
            })
        }
    }, [intent, agenticModel, /*models,*/ extensionAPI.setChatModel])

    const onModelSelect = useCallback(
        (model: Model) => {
            extensionAPI.setChatModel(model.id).subscribe({
                error: error => console.error('setChatModel:', error),
            })
            focusEditor?.()
        },
        [extensionAPI.setChatModel, focusEditor]
    )

    return (
        !!models?.length &&
        (userInfo.isDotComUser || serverSentModelsEnabled) && (
            <ModelSelectField
                models={models}
                onModelSelect={onModelSelect}
                serverSentModelsEnabled={serverSentModelsEnabled}
                userInfo={userInfo}
                className={className}
                data-testid="chat-model-selector"
                modelSelectorRef={modelSelectorRef}
                onCloseByEscape={() => modelSelectorRef?.current?.close()}
                intent={intent}
            />
        )
    )
}
