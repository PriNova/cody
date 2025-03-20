import clsx from 'clsx'
import type { FC } from 'react'

interface TokenDisplayProps {
    current: number
    total?: number
    limit: number
    className?: string
    showTotalOnly?: boolean
}

// Helper function to format numbers to "k" format for values ≥ 1000
// If includeDecimal is true, include one decimal place
const formatToK = (num: number, includeDecimal = false): string => {
    if (num < 1000) {
        return num.toString()
    }

    if (includeDecimal) {
        // Format with one decimal place (e.g., 10.5k)
        return `${(num / 1000).toFixed(1)}k`.replace('.0k', 'k') // Remove .0 if it's a whole number
    }
    // Format with no decimal places (e.g., 10k)
    return `${(num / 1000).toFixed(0)}k`
}

export const TokenDisplay: FC<TokenDisplayProps> = ({
    current,
    total,
    limit,
    className,
    showTotalOnly = false,
}) => {
    // If total is provided, use it for calculations, otherwise just use current
    const displayTokens = showTotalOnly && total !== undefined ? total : current
    const totalTokens = total !== undefined ? total + current : current
    const usage = showTotalOnly ? totalTokens / limit : displayTokens / limit
    const isNearLimit = usage > 0.8
    const isAtLimit = usage > 0.95

    // Format the tokens with one decimal place and the limit with no decimal places
    //const formattedDisplayTokens = formatToK(displayTokens, true)
    //const formattedTotalTokens = formatToK(totalTokens, true)
    const formattedLimit = formatToK(limit)

    // Calculate the progress percentage (capped at 100%)
    const progressPercentage = Math.min(usage * 100, 100)

    // Determine text color based on usage
    const colorClass = clsx(
        'tw-transition-colors',
        isAtLimit && 'tw-text-red-500',
        isNearLimit && 'tw-text-yellow-500',
        !isNearLimit && !isAtLimit && 'tw-text-green-500'
    )

    return (
        <div
            className={clsx('tw-flex tw-items-center tw-text-xs tw-w-full', className)}
            title="Token usage affects model's ability to process your input"
        >
            {/* Progress bar container - positioned first */}
            <div className="tw-flex-grow tw-h-2 tw-rounded-full tw-overflow-hidden tw-mr-2 tw-bg-border">
                {/* Progress bar fill */}
                <div
                    className={clsx(
                        'tw-h-full tw-rounded-full tw-transition-all',
                        isAtLimit && 'tw-bg-red-500',
                        isNearLimit && 'tw-bg-yellow-500',
                        !isNearLimit && !isAtLimit && 'tw-bg-green-500'
                    )}
                    style={{ width: `${progressPercentage}%` }}
                />
            </div>

            {/* Text next to the progress bar - using flex-shrink-0 to prevent text from shrinking */}
            <span className={clsx(colorClass, 'tw-flex-shrink-0')}>
                {showTotalOnly && total !== undefined ? (
                    <>
                        {totalTokens} / {formattedLimit}
                    </>
                ) : (
                    <>
                        {displayTokens} / {formattedLimit}
                    </>
                )}
                {displayTokens > limit && (
                    <span className="tw-ml-1" title="Tokens exceed limit">
                        ⚠️
                    </span>
                )}
            </span>
        </div>
    )
}
