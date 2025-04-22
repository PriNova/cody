import {
    type AuthStatus,
    type ChatMessage,
    type ClientCapabilitiesWithLegacyFields,
    type CodyNotice,
    FeatureFlag,
    type Guardrails,
    type UserProductSubscription,
    type WebviewToExtensionAPI,
    firstValueFrom,
} from '@sourcegraph/cody-shared'
import { useExtensionAPI, useObservable } from '@sourcegraph/prompt-editor'
import { Cpu, Database, Globe, Shield } from 'lucide-react' // Import needed icons
import type React from 'react'
import { type FunctionComponent, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigurationSubsetForWebview, LocalEnv } from '../src/chat/protocol'
import styles from './App.module.css'
import { Chat } from './Chat'
import { useClientActionDispatcher } from './client/clientState'
import { Notices } from './components/Notices'
import { StateDebugOverlay } from './components/StateDebugOverlay'
import type { ServerType } from './components/mcp' // Import the webview's ServerType
import { ServerHome } from './components/mcp/ServerHome'
import { TabContainer, TabRoot } from './components/shadcn/ui/tabs'
import { HistoryTab, PromptsTab, TabsBar, View } from './tabs'
import ToolboxTab from './tabs/ToolboxTab'
import type { VSCodeWrapper } from './utils/VSCodeApi'
import { useUserAccountInfo } from './utils/useConfig'
import { useFeatureFlag } from './utils/useFeatureFlags'
import { TabViewContext } from './utils/useTabView'
// Import McpServer type from shared if needed for clarity, or rely on the api return type
// import type { McpServer } from '@sourcegraph/cody-shared/src/llm-providers/mcp/types';

interface CodyPanelProps {
    view: View
    setView: (view: View) => void
    configuration: {
        config: LocalEnv & ConfigurationSubsetForWebview
        clientCapabilities: ClientCapabilitiesWithLegacyFields
        authStatus: AuthStatus
        isDotComUser: boolean
        userProductSubscription?: UserProductSubscription | null | undefined
    }
    errorMessages: string[]
    chatEnabled: boolean
    instanceNotices: CodyNotice[]
    messageInProgress: ChatMessage | null
    transcript: ChatMessage[]
    vscodeAPI: Pick<VSCodeWrapper, 'postMessage' | 'onMessage'>
    setErrorMessages: (errors: string[]) => void
    guardrails: Guardrails
    showWelcomeMessage?: boolean
    showIDESnippetActions?: boolean
    onExternalApiReady?: (api: CodyExternalApi) => void
    onExtensionApiReady?: (api: WebviewToExtensionAPI) => void
}

/**
 * Helper function to map backend McpServer to webview ServerType
 */
function mapMcpServerToServerType(mcpServer: any): ServerType {
    let parsedConfig = {} as any
    try {
        if (mcpServer.config) {
            parsedConfig = JSON.parse(mcpServer.config)
        }
    } catch (error) {
        console.error('Failed to parse MCP server config string:', mcpServer.name, error)
        // Return minimal server info if config parsing fails
        return {
            id: mcpServer.name,
            name: mcpServer.name,
            type: mcpServer.type || 'unknown', // Use 'unknown' if type is missing
            status: mcpServer.status === 'connected' ? 'online' : 'offline',
            icon: Globe, // Default icon
            tools: mcpServer.tools,
            url: '',
            command: '',
            args: [''],
            env: [{ name: '', value: '' }],
            metrics: undefined, // Or map if available
            // Keep config string for update logic if needed, or remove
            config: mcpServer.config,
        } as ServerType
    }

    // Map icon based on type or default
    let icon = Globe
    switch (parsedConfig.type?.toLowerCase()) {
        case 'database':
            icon = Database
            break
        case 'worker':
            icon = Cpu
            break
        case 'service':
            icon = Shield
            break
        default:
            icon = Globe // Default to Globe or another generic icon
    }

    return {
        id: mcpServer.name, // Use name as ID as per existing webview logic
        name: mcpServer.name,
        type: parsedConfig.type || 'MCP', // Use parsed type or default to MCP
        status: mcpServer.status === 'connected' ? 'online' : 'offline',
        icon, // Use determined icon
        url: parsedConfig.url || '',
        command: parsedConfig.command || '',
        // Ensure args is always an array, default to [''] if not present or not an array
        args: Array.isArray(parsedConfig.args) ? parsedConfig.args : [''],
        // Ensure env is always an array, default to [{ name: '', value: '' }] if not present or not an array
        env: Array.isArray(parsedConfig.env) ? parsedConfig.env : [{ name: '', value: '' }],
        metrics: mcpServer.metrics, // Map metrics if available from backend
        tools: mcpServer.tools,
        // Keep config string for update logic if needed, or remove
        config: mcpServer.config,
    } as ServerType // Cast to the webview's ServerType
}

/**
 * The Cody tab panel, with tabs for chat, history, prompts, etc.
 */
export const CodyPanel: FunctionComponent<CodyPanelProps> = ({
    view,
    setView,
    configuration: { config, clientCapabilities, isDotComUser },
    errorMessages,
    setErrorMessages,
    chatEnabled,
    instanceNotices,
    messageInProgress,
    transcript,
    vscodeAPI,
    showIDESnippetActions,
    showWelcomeMessage,
    onExternalApiReady,
    onExtensionApiReady,
    guardrails,
}) => {
    const tabContainerRef = useRef<HTMLDivElement>(null)

    const user = useUserAccountInfo()
    const externalAPI = useExternalAPI()
    const api = useExtensionAPI()
    const { value: chatModels } = useObservable(useMemo(() => api.chatModels(), [api.chatModels]))

    // ** FIX START **
    // Fetch McpServer[] from the backend (which has the 'config' string)
    const { value: backendMcpServers } = useObservable(
        useMemo(() => api.mcpSettings(), [api.mcpSettings])
    )

    // Map the backend McpServer[] to the webview's ServerType[]
    const mcpServers: ServerType[] | undefined | null = useMemo(() => {
        if (!backendMcpServers) {
            return backendMcpServers // null or undefined
        }
        // If backendMcpServers is the special -1 value indicating disabled, return []
        if (backendMcpServers.length === -1) {
            return []
        }

        // Map each backend McpServer to the webview ServerType
        return backendMcpServers.map(mapMcpServerToServerType)
    }, [backendMcpServers])
    // ** FIX END **

    // workspace upgrade eligibility should be that the flag is set, is on dotcom and only has one account. This prevents enterprise customers that are logged into multiple endpoints from seeing the CTA
    const isWorkspacesUpgradeCtaEnabled =
        useFeatureFlag(FeatureFlag.SourcegraphTeamsUpgradeCTA) &&
        isDotComUser &&
        config.endpointHistory?.length === 1
    useEffect(() => {
        onExternalApiReady?.(externalAPI)
    }, [onExternalApiReady, externalAPI])

    useEffect(() => {
        onExtensionApiReady?.(api)
    }, [onExtensionApiReady, api])

    useEffect(() => {
        const subscription = api.clientActionBroadcast().subscribe(action => {
            switch (action.type) {
                case 'open-recently-prompts': {
                    document
                        .querySelector<HTMLButtonElement>("button[aria-label='Insert prompt']")
                        ?.click()
                }
            }
        })

        return () => {
            subscription.unsubscribe()
        }
    }, [api.clientActionBroadcast])

    const [historySearchQuery, setHistorySearchQuery] = useState('')

    return (
        <TabViewContext.Provider value={useMemo(() => ({ view, setView }), [view, setView])}>
            <TabRoot
                defaultValue={View.Chat}
                value={view}
                orientation="vertical"
                className={styles.outerContainer}
            >
                <Notices user={user} instanceNotices={instanceNotices} />
                {/* Hide tab bar in editor chat panels. */}
                {config.webviewType !== 'editor' && (
                    <TabsBar
                        user={user}
                        currentView={view}
                        setView={setView}
                        endpointHistory={config.endpointHistory ?? []}
                        isWorkspacesUpgradeCtaEnabled={isWorkspacesUpgradeCtaEnabled}
                        showOpenInEditor={!!config?.multipleWebviewsEnabled && !transcript.length}
                    />
                )}
                {errorMessages && <ErrorBanner errors={errorMessages} setErrors={setErrorMessages} />}
                <TabContainer
                    value={view}
                    ref={tabContainerRef}
                    data-scrollable
                    className="tw-overflow-auto tw-relative"
                >
                    {view === View.Chat && (
                        <Chat
                            chatEnabled={chatEnabled}
                            messageInProgress={messageInProgress}
                            transcript={transcript}
                            models={chatModels || []}
                            vscodeAPI={vscodeAPI}
                            guardrails={guardrails}
                            showIDESnippetActions={showIDESnippetActions}
                            showWelcomeMessage={showWelcomeMessage}
                            scrollableParent={tabContainerRef.current}
                            setView={setView}
                            isWorkspacesUpgradeCtaEnabled={isWorkspacesUpgradeCtaEnabled}
                        />
                    )}
                    {view === View.History && (
                        <HistoryTab
                            IDE={clientCapabilities.agentIDE}
                            setView={setView}
                            webviewType={config.webviewType}
                            multipleWebviewsEnabled={config.multipleWebviewsEnabled}
                            searchQuery={historySearchQuery}
                            onSearchQueryChange={setHistorySearchQuery}
                        />
                    )}
                    {view === View.Toolbox && config.webviewType === 'sidebar' && (
                        <ToolboxTab setView={setView} />
                    )}
                    {view === View.Prompts && (
                        <PromptsTab IDE={clientCapabilities.agentIDE} setView={setView} />
                    )}
                    {/* Only show ServerHome if agentic chat is enabled and mcpServers data is available */}
                    {view === View.Settings &&
                        config?.experimentalAgenticChatEnabled &&
                        mcpServers && // Ensure mcpServers is not null/undefined
                        mcpServers.length !== -1 && ( // Check for the special -1 case from backend
                            <ServerHome mcpServers={mcpServers} />
                        )}
                </TabContainer>
                <StateDebugOverlay />
            </TabRoot>
        </TabViewContext.Provider>
    )
}

const ErrorBanner: React.FunctionComponent<{ errors: string[]; setErrors: (errors: string[]) => void }> =
    ({ errors, setErrors }) => (
        <div className={styles.errorContainer}>
            {errors.map((error, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: error strings might not be unique, so we have no natural id
                <div key={i} className={styles.error}>
                    <span>{error}</span>
                    <button
                        type="button"
                        className={styles.closeBtn}
                        onClick={() => setErrors(errors.filter(e => e !== error))}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    )

interface ExternalPrompt {
    text: string
    autoSubmit: boolean
    mode?: ChatMessage['intent']
}

interface CodyExternalApi {
    runPrompt: (action: ExternalPrompt) => Promise<void>
}

function useExternalAPI(): CodyExternalApi {
    const dispatchClientAction = useClientActionDispatcher()
    const extensionAPI = useExtensionAPI()

    return useMemo(
        () => ({
            runPrompt: async (prompt: ExternalPrompt) => {
                const promptEditorState = await firstValueFrom(
                    extensionAPI.hydratePromptMessage(prompt.text)
                )

                dispatchClientAction(
                    {
                        editorState: promptEditorState,
                        submitHumanInput: prompt.autoSubmit,
                        setLastHumanInputIntent: prompt.mode ?? 'chat',
                    },
                    // Buffer because PromptEditor is not guaranteed to be mounted after the `setView`
                    // call above, and it needs to be mounted to receive the action.
                    { buffer: true }
                )
            },
        }),
        [extensionAPI, dispatchClientAction]
    )
}
