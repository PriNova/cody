import { isDefined } from '@sourcegraph/cody-shared'
import clsx from 'clsx'
import { type FunctionComponent, useMemo } from 'react'
import { Button } from '../../../../components/shadcn/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/shadcn/ui/tooltip'
import { getVSCodeAPI } from '../../../../utils/VSCodeApi'
import type {
    HumanMessageInitialContextInfo as InitialContextInfo,
    PriorHumanMessageInfo,
} from './AssistantMessageCell'

export const ContextFocusActions: FunctionComponent<{
    humanMessage: PriorHumanMessageInfo
    longResponseTime?: boolean
    className?: string
}> = ({ humanMessage, longResponseTime, className }) => {
    const actions = useMemo(
        () =>
            (
                [
                    humanMessage.hasInitialContext.repositories || humanMessage.hasInitialContext.files
                        ? {
                              label: 'Public knowledge only',
                              tooltip: 'Try again without context about your code',
                              onClick: () => {
                                  const options: InitialContextInfo = {
                                      repositories: false,
                                      files: false,
                                  }

                                  humanMessage.rerunWithDifferentContext(options)
                              },
                          }
                        : null,
                    humanMessage.hasInitialContext.repositories && humanMessage.hasInitialContext.files
                        ? {
                              label: 'Current file only',
                              tooltip: 'Try again, focused on the current file',
                              onClick: () => {
                                  const options: InitialContextInfo = {
                                      repositories: false,
                                      files: true,
                                  }

                                  humanMessage.rerunWithDifferentContext(options)
                              },
                          }
                        : null,
                    longResponseTime
                        ? {
                              label: 'Try again with a different model',
                              tooltip:
                                  'A new window will open with a copy of the current conversation where you can resubmit your request with a different model',
                              onClick: () => {
                                  getVSCodeAPI().postMessage({
                                      command: 'chatSession',
                                      action: 'duplicate',
                                  })
                              },
                          }
                        : {
                              label: 'Add context...',
                              tooltip: 'Add relevant content to improve the response',
                              onClick: () => {
                                  humanMessage.appendAtMention()
                              },
                          },
                ] as { label: string; tooltip: string; onClick: () => void }[]
            )
                .flat()
                .filter(isDefined),
        [humanMessage, longResponseTime]
    )
    return actions.length > 0 ? (
        <menu
            className={clsx('tw-flex tw-gap-2 tw-text-sm tw-text-muted-foreground', className)}
            role="group"
            aria-label="Try again with different context"
        >
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-2">
                {!longResponseTime && (
                    <h3 className="tw-flex tw-items-center tw-gap-3">
                        Try again with different context
                    </h3>
                )}
                <ul className="tw-whitespace-nowrap tw-flex tw-gap-2 tw-flex-wrap">
                    {actions.map(({ label, tooltip, onClick }) => (
                        <li key={label}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        key={label}
                                        variant="outline"
                                        size="sm"
                                        onClick={onClick}
                                        tabIndex={-1}
                                    >
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
    ) : null
}
