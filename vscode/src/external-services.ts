import type * as vscode from 'vscode'

import {
    ChatClient,
    type ClientConfiguration,
    type SourcegraphCompletionsClient,
    SourcegraphGuardrailsClient,
} from '@sourcegraph/cody-shared'

import { completionsLifecycleOutputChannelLogger } from './completions/output-channel-logger'
import type { PlatformContext } from './extension.common'
import type { SymfRunner } from './local-context/symf'

interface ExternalServices {
    chatClient: ChatClient
    completionsClient: SourcegraphCompletionsClient
    guardrails: SourcegraphGuardrailsClient
    symfRunner: SymfRunner | undefined
    dispose(): void
}

interface ExternalServicesConfig {
    config: ClientConfiguration // Complete config type from your codebase
    context: vscode.ExtensionContext
    platform: Pick<
        PlatformContext,
        | 'createCompletionsClient'
        | 'createSentryService'
        | 'createOpenTelemetryService'
        | 'createSymfRunner'
    >
}

export async function configureExternalServices({
    config,
    context,
    platform,
}: ExternalServicesConfig): Promise<ExternalServices> {
    const disposables: (vscode.Disposable | undefined)[] = []

    const sentryService = platform.createSentryService?.()
    if (sentryService) disposables.push(sentryService)

    const openTelemetryService = platform.createOpenTelemetryService?.()
    if (openTelemetryService) disposables.push(openTelemetryService)

    const completionsClient = platform.createCompletionsClient(completionsLifecycleOutputChannelLogger)

    const symfRunner = platform.createSymfRunner?.(context)
    if (symfRunner) disposables.push(symfRunner)

    const chatClient = new ChatClient({
        temperature: config.chatTemperature,
        completions: completionsClient,
    })

    const guardrails = new SourcegraphGuardrailsClient()

    return {
        chatClient,
        completionsClient,
        guardrails,
        symfRunner,
        dispose(): void {
            for (const d of disposables) {
                d?.dispose()
            }
        },
    }
}
