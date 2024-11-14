import clsx from 'clsx'
import type { FC } from 'react'

interface TokenDisplayProps {
    current: number
    total?: number
    limit: number
    className?: string
}

export const TokenDisplay: FC<TokenDisplayProps> = ({ current, total, limit, className }) => {
    const usage = (total || 0) / limit
    const isNearLimit = usage > 0.8
    const isAtLimit = usage > 0.95

    return (
        <div
            className={clsx('tw-flex tw-flex-col tw-text-xs tw-ml-2', className)}
            title="Token usage affects model's ability to process your input"
        >
            <span>Current: {current}</span>
            {total && (
                <span
                    className={clsx(
                        'tw-transition-colors',
                        isAtLimit && 'tw-text-red-500',
                        isNearLimit && 'tw-text-yellow-500',
                        !isNearLimit && !isAtLimit && 'tw-text-green-500'
                    )}
                >
                    Total: {total + current} / {limit}
                    {total + current > limit && (
                        <span className="tw-ml-1" title="Total tokens exceed limit">
                            ⚠️
                        </span>
                    )}
                </span>
            )}
        </div>
    )
}
