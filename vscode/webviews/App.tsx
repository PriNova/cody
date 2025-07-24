import { type ComponentProps, useEffect, useMemo, useState } from 'react'

import {
    type ChatMessage,
    type CodyClientConfig,
    type DefaultContext,
    PromptString,
    createGuardrailsImpl,
} from '@sourcegraph/cody-shared'
import { LoadingPage } from './LoadingPage'
import { useClientActionDispatcher } from './client/clientState'
import { WebviewOpenTelemetryService } from './utils/webviewOpenTelemetryService'

import { ExtensionAPIProviderFromVSCodeAPI } from '@sourcegraph/prompt-editor'
import { CodyPanel } from './CodyPanel'
import { useSuppressKeys } from './components/hooks'
import { View } from './tabs'
import type { VSCodeWrapper } from './utils/VSCodeApi'
import { ComposedWrappers, type Wrapper } from './utils/composeWrappers'
import { updateDisplayPathEnvInfoForWebview } from './utils/displayPathEnvInfo'
import { ClientConfigProvider } from './utils/useClientConfig'
import { type Config, ConfigProvider } from './utils/useConfig'
import { useDevicePixelRatioNotifier } from './utils/useDevicePixelRatio'
import { LinkOpenerProvider } from './utils/useLinkOpener'

export const App: React.FunctionComponent<{ vscodeAPI: VSCodeWrapper }> = ({ vscodeAPI }) => {
    const [config, setConfig] = useState<Config | null>(null)
    const [clientConfig, setClientConfig] = useState<CodyClientConfig | null>(null)
    // NOTE: View state will be set by the extension host during initialization.
    const [view, setView] = useState<View>()
    const [messageInProgress, setMessageInProgress] = useState<ChatMessage | null>(null)

    const [transcript, setTranscript] = useState<ChatMessage[]>([])

    const [errorMessages, setErrorMessages] = useState<string[]>([])

    const dispatchClientAction = useClientActionDispatcher()

    const clientConfigAttribution = clientConfig?.attribution ?? 'none'
    const guardrails = useMemo(() => {
        return createGuardrailsImpl(clientConfigAttribution, (snippet: string) => {
            vscodeAPI.postMessage({
                command: 'attribution-search',
                snippet,
            })
        })
    }, [vscodeAPI, clientConfigAttribution])

    useSuppressKeys()

    useEffect(
        () =>
            vscodeAPI.onMessage(message => {
                switch (message.type) {
                    case 'ui/theme': {
                        document.documentElement.dataset.ide = message.agentIDE
                        const rootStyle = document.documentElement.style
                        for (const [name, value] of Object.entries(message.cssVariables || {})) {
                            rootStyle.setProperty(name, value)
                        }
                        break
                    }
                    case 'transcript': {
                        const deserializedMessages = message.messages.map(
                            PromptString.unsafe_deserializeChatMessage
                        )
                        if (message.isMessageInProgress) {
                            const msgLength = deserializedMessages.length - 1
                            setTranscript(deserializedMessages.slice(0, msgLength))
                            setMessageInProgress(deserializedMessages[msgLength])
                        } else {
                            setTranscript(deserializedMessages)
                            setMessageInProgress(null)
                        }
                        vscodeAPI.setState(message.chatID)
                        break
                    }
                    case 'config':
                        setConfig(message)
                        updateDisplayPathEnvInfoForWebview(message.workspaceFolderUris)
                        // Reset to the default view (Chat) for unauthenticated users.
                        if (view && view !== View.Chat && !message.authStatus?.authenticated) {
                            setView(View.Chat)
                        }
                        break
                    case 'clientConfig':
                        if (message.clientConfig) {
                            setClientConfig(message.clientConfig)
                        }
                        break
                    case 'clientAction':
                        dispatchClientAction(message)
                        break
                    case 'errors':
                        setErrorMessages(prev => [...prev, message.errors].slice(-5))
                        break
                    case 'view':
                        setView(message.view)
                        break
                    case 'attribution':
                        if (message.attribution) {
                            guardrails.notifyAttributionSuccess(message.snippet, {
                                repositories: message.attribution.repositoryNames.map(name => {
                                    return { name }
                                }),
                                limitHit: message.attribution.limitHit,
                            })
                        }
                        if (message.error) {
                            guardrails.notifyAttributionFailure(
                                message.snippet,
                                new Error(message.error)
                            )
                        }
                        break
                }
            }),
        [view, vscodeAPI, guardrails, dispatchClientAction]
    )

    useEffect(() => {
        // Notify the extension host that we are ready to receive events
        vscodeAPI.postMessage({ command: 'ready' })
    }, [vscodeAPI])

    useEffect(() => {
        if (!view) {
            vscodeAPI.postMessage({ command: 'initialized' })
            return
        }
    }, [view, vscodeAPI])

    const webviewTelemetryService = useMemo(() => {
        const service = WebviewOpenTelemetryService.getInstance()
        return service
    }, [])

    useEffect(() => {
        if (config) {
            webviewTelemetryService.configure({
                isTracingEnabled: true,
                debugVerbose: true,
                ide: config.clientCapabilities.agentIDE,
                codyExtensionVersion: config.clientCapabilities.agentExtensionVersion,
            })
        }
    }, [config, webviewTelemetryService])

    // Notify the extension host of the device pixel ratio
    // Currently used for image generation in auto-edit.
    useDevicePixelRatioNotifier()

    const wrappers = useMemo<Wrapper[]>(
        () => getAppWrappers({ vscodeAPI, config, clientConfig }),
        [vscodeAPI, config, clientConfig]
    )

    // Wait for all the data to be loaded before rendering Chat View
    if (!view || !config) {
        return <LoadingPage />
    }

    return (
        <ComposedWrappers wrappers={wrappers}>
            <CodyPanel
                view={view}
                setView={setView}
                configuration={config}
                errorMessages={errorMessages}
                setErrorMessages={setErrorMessages}
                chatEnabled={clientConfig?.chatEnabled ?? true}
                instanceNotices={clientConfig?.notices ?? []}
                messageInProgress={messageInProgress}
                transcript={transcript}
                vscodeAPI={vscodeAPI}
                guardrails={guardrails}
            />
        </ComposedWrappers>
    )
}

interface GetAppWrappersOptions {
    vscodeAPI: VSCodeWrapper
    config: Config | null
    clientConfig: CodyClientConfig | null
    staticDefaultContext?: DefaultContext
}

export function getAppWrappers({
    vscodeAPI,
    config,
    clientConfig,
    staticDefaultContext,
}: GetAppWrappersOptions): Wrapper[] {
    return [
        {
            component: ExtensionAPIProviderFromVSCodeAPI,
            props: { vscodeAPI, staticDefaultContext },
        } satisfies Wrapper<any, ComponentProps<typeof ExtensionAPIProviderFromVSCodeAPI>>,
        {
            component: ConfigProvider,
            props: { value: config },
        } satisfies Wrapper<any, ComponentProps<typeof ConfigProvider>>,
        {
            component: ClientConfigProvider,
            props: { value: clientConfig },
        } satisfies Wrapper<any, ComponentProps<typeof ClientConfigProvider>>,
        {
            component: LinkOpenerProvider,
            props: { vscodeAPI },
        } satisfies Wrapper<any, ComponentProps<typeof LinkOpenerProvider>>,
    ]
}
