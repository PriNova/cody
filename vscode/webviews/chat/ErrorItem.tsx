import type React from 'react'
import { useCallback } from 'react'

import { type ChatError, FeatureFlag, RateLimitError } from '@sourcegraph/cody-shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/shadcn/ui/tooltip'
import type {
    HumanMessageInitialContextInfo as InitialContextInfo,
    PriorHumanMessageInfo,
} from './cells/messageCell/assistant/AssistantMessageCell'

import type { UserAccountInfo } from '../Chat'
import type { ApiPostMessage } from '../Chat'

import { Button } from '../components/shadcn/ui/button'

import { useFeatureFlag } from '../utils/useFeatureFlags'
import styles from './ErrorItem.module.css'

/**
 * An error message shown in the chat.
 */
export const ErrorItem: React.FunctionComponent<{
    error: Omit<ChatError, 'isChatErrorGuard'>
    userInfo: Pick<UserAccountInfo, 'isCodyProUser' | 'isDotComUser'>
    postMessage?: ApiPostMessage
    humanMessage?: PriorHumanMessageInfo | null
}> = ({ error, userInfo, postMessage, humanMessage }) => {
    if (typeof error !== 'string' && error.name === RateLimitError.errorName && postMessage) {
        return (
            <RateLimitErrorItem
                error={error as RateLimitError}
                userInfo={userInfo}
                postMessage={postMessage}
            />
        )
    }
    return <RequestErrorItem error={error} humanMessage={humanMessage} />
}

/**
 * Renders a generic error message for chat request failures.
 */
export const RequestErrorItem: React.FunctionComponent<{
    error: Error
    humanMessage?: PriorHumanMessageInfo | null
}> = ({ error, humanMessage }) => {
    const isApiVersionError = error.message.includes('unable to determine Cody API version')

    const actions =
        isApiVersionError && humanMessage
            ? [
                  {
                      label: 'Try again',
                      tooltip: 'Retry request without code context',
                      onClick: () => {
                          const options: InitialContextInfo = {
                              repositories: false,
                              files: false,
                          }
                          humanMessage.rerunWithDifferentContext(options)
                      },
                  },
              ]
            : []

    return (
        <div className={styles.requestError}>
            <div className={styles.errorContent}>
                <span className={styles.requestErrorTitle}>Request Failed: </span>
                {error.message}
            </div>
            {actions.length > 0 && (
                <menu className="tw-flex tw-gap-2 tw-text-sm tw-text-muted-foreground">
                    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-2">
                        <ul className="tw-whitespace-nowrap tw-flex tw-gap-2 tw-flex-wrap">
                            {actions.map(({ label, tooltip, onClick }) => (
                                <li key={label}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="outline" size="sm" onClick={onClick}>
                                                {label}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{tooltip}</TooltipContent>
                                    </Tooltip>
                                </li>
                            ))}
                        </ul>
                    </div>
                </menu>
            )}
        </div>
    )
}
/**
 * An error message shown in the chat.
 */
const RateLimitErrorItem: React.FunctionComponent<{
    error: RateLimitError
    userInfo: Pick<UserAccountInfo, 'isCodyProUser' | 'isDotComUser'>
    postMessage: ApiPostMessage
}> = ({ error, userInfo, postMessage }) => {
    // Only show Upgrades if both the error said an upgrade was available and we know the user
    // has not since upgraded.
    const canUpgrade = error.upgradeIsAvailable && !userInfo?.isCodyProUser

    const onButtonClick = useCallback(
        (page: 'upgrade' | 'rate-limits', call_to_action: 'upgrade' | 'learn-more'): void => {
            // Log click event

            // open the page in browser
            postMessage({ command: 'show-page', page })
        },
        [postMessage]
    )

    let ctaText = canUpgrade ? 'Upgrade to Cody Pro' : 'Unable to Send Message'

    const fallbackToFlash = useFeatureFlag(FeatureFlag.FallbackToFlash)

    if (fallbackToFlash) {
        if (userInfo?.isCodyProUser) {
            ctaText = 'Upgrade to Cody Enterprise'
        } else if (!canUpgrade) {
            ctaText = 'Usage limit of premium models reached, switching the model to Gemini Flash.'
        }
    }

    return (
        <div className={styles.errorItem}>
            {canUpgrade && <div className={styles.icon}>⚡️</div>}
            <div className={styles.body}>
                <header>
                    <h1>{ctaText}</h1>
                    <p>
                        {error.userMessage}
                        {fallbackToFlash &&
                            !canUpgrade &&
                            ' You can continue using Gemini Flash, or other standard models.'}
                        {canUpgrade &&
                            ' Upgrade to Cody Pro for unlimited autocomplete suggestions, and increased limits for chat messages and commands.'}
                    </p>
                </header>
                <div className={styles.actions}>
                    {canUpgrade && (
                        <Button onClick={() => onButtonClick('upgrade', 'upgrade')}>Upgrade</Button>
                    )}
                    {error.feature !== 'Agentic Chat' && (
                        <Button
                            type="button"
                            onClick={() =>
                                canUpgrade
                                    ? onButtonClick('upgrade', 'upgrade')
                                    : onButtonClick('rate-limits', 'learn-more')
                            }
                            variant="secondary"
                        >
                            {canUpgrade ? 'See Plans →' : 'Learn More'}
                        </Button>
                    )}
                </div>
                {error.retryMessage && <p className={styles.retryMessage}>{error.retryMessage}</p>}
                {canUpgrade && (
                    <div className={styles.bannerContainer}>
                        <div
                            className={styles.banner}
                            role="button"
                            tabIndex={-1}
                            onClick={() => onButtonClick('upgrade', 'upgrade')}
                            onKeyDown={() => onButtonClick('upgrade', 'upgrade')}
                        >
                            Go Pro
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
