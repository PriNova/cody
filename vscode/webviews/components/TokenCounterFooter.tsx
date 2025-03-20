import clsx from 'clsx'
import type React from 'react'
import { TokenDisplay } from '../chat/cells/messageCell/human/editor/toolbar/TokenDisplay'

interface TokenCounterFooterProps {
    currentTokens: number
    transcriptTokens: number
    contextWindow: number
    className?: string
}

export const TokenCounterFooter: React.FC<TokenCounterFooterProps> = ({
    currentTokens,
    transcriptTokens,
    contextWindow,
    className,
}) => {
    return (
        <div
            className={clsx(
                'tw-sticky tw-bottom-0 tw-left-0 tw-right-0 tw-bg-background tw-border-t tw-border-border tw-p-2 tw-flex tw-items-center tw-z-10',
                className
            )}
        >
            <div className="tw-text-xs tw-text-secondary-foreground tw-mr-4 tw-flex-shrink-0">
                Token Usage
            </div>
            <TokenDisplay
                current={currentTokens}
                total={transcriptTokens}
                limit={contextWindow}
                showTotalOnly={true}
                className="tw-flex-grow"
            />
        </div>
    )
}
