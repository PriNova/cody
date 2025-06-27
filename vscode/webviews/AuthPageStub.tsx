import type React from 'react'

/**
 * Stub component for standalone mode - auth functionality is disabled
 */
export const AuthPage: React.FunctionComponent = () => {
    return (
        <div className="tw-flex tw-flex-col tw-w-full tw-h-full tw-p-10 tw-items-center tw-justify-center">
            <div className="tw-text-center tw-text-muted-foreground">
                <h2 className="tw-text-xl tw-font-semibold tw-mb-4">Cody Standalone Mode</h2>
                <p>Authentication is disabled in standalone mode.</p>
            </div>
        </div>
    )
}
