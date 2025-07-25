import {
    type AuthCredentials,
    type AuthStatus,
    type ClientCapabilitiesWithLegacyFields,
    DOTCOM_URL,
    type ResolvedConfiguration,
    type Unsubscribable,
    currentResolvedConfig,
    clientCapabilities as getClientCapabilities,
    mockLocalStorageAuthStatus,
    resolvedConfig as resolvedConfig_,
    setAuthStatusObservable as setAuthStatusObservable_,
} from '@sourcegraph/cody-shared'
import { normalizeServerEndpointURL } from '@sourcegraph/cody-shared/src/configuration/auth-resolver'
// DISABLED: Error handling imports no longer needed for mock auth
// import {
//     isAvailabilityError,
//     isInvalidAccessTokenError,
// } from '@sourcegraph/cody-shared/src/sourcegraph-api/errors'
import { Subject } from 'observable-fns'
import type * as vscode from 'vscode'
import { serializeConfigSnapshot } from '../../uninstall/serializeConfig'
import { type ResolvedConfigurationCredentialsOnly, validateCredentials } from '../auth/auth'
// DISABLED: Logging not needed for mock auth
// import { logError } from '../output-channel-logger'
import { version } from '../version'
import { localStorage } from './LocalStorageProvider'

const HAS_AUTHENTICATED_BEFORE_KEY = 'has-authenticated-before'

class AuthProvider implements vscode.Disposable {
    private status = new Subject<AuthStatus>()
    private refreshRequests = new Subject<boolean>()

    /**
     * Credentials that were already validated with
     * {@link AuthProvider.validateAndStoreCredentials}.
     */
    private lastValidatedAndStoredCredentials =
        new Subject<ResolvedConfigurationCredentialsOnly | null>()
    private lastEndpoint: string | undefined

    private hasAuthed = false

    private subscriptions: Unsubscribable[] = []

    private initializeMockAuth(): void {
        // Use enhanced mock that provides complete AuthStatus for UI functionality
        // Initial setup with fallback
        mockLocalStorageAuthStatus()

        this.mockUserProductSubscriptionComprehensive()
        this.mockGraphQLOperationsForTesting()
        this.mockModelPreferencesForTesting()
    }

    public refreshWithRealUsername(): void {
        try {
            // Call mockLocalStorageAuthStatus again with initialized localStorage
            mockLocalStorageAuthStatus(localStorage)
        } catch (error) {
            console.error('Error in refreshWithRealUsername:', error)
        }
    }

    /**
     * Comprehensive userProductSubscription mocking that avoids "getter-only" property errors
     * by mocking at multiple levels of the Observable pipeline.
     */
    private mockUserProductSubscriptionComprehensive(): void {
        try {
            // Strategy 1: Mock at GraphQL client level (source of the Observable pipeline)
            this.mockGraphQLClientForSubscription()

            // Strategy 2: Mock at module level before imports are cached
            this.mockAtModuleLevel()

            // Strategy 3: Create Observable override if direct property access fails
            this.createObservableOverride()

            console.log('Comprehensive userProductSubscription mocking initialized successfully')
        } catch (error) {
            console.warn('Failed to initialize comprehensive subscription mocking:', error)
            // Fallback to simpler approaches if comprehensive mocking fails
            this.mockGraphQLClientForSubscription()
        }
    }

    private mockGraphQLClientForSubscription(): void {
        try {
            const graphqlClientModule = require('@sourcegraph/cody-shared/src/sourcegraph-api/graphql')
            if (graphqlClientModule?.graphqlClient) {
                const originalGetCurrentUserCodySubscription =
                    graphqlClientModule.graphqlClient.getCurrentUserCodySubscription
                const originalGetCurrentUserCodyProEnabled =
                    graphqlClientModule.graphqlClient.getCurrentUserCodyProEnabled

                // Mock getCurrentUserCodySubscription
                if (
                    originalGetCurrentUserCodySubscription &&
                    !originalGetCurrentUserCodySubscription.__mocked
                ) {
                    // Mock to return Pro subscription data
                    graphqlClientModule.graphqlClient.getCurrentUserCodySubscription = async (
                        signal?: AbortSignal
                    ) => {
                        return {
                            plan: 'PRO',
                            status: 'ACTIVE',
                        }
                    }
                    graphqlClientModule.graphqlClient.getCurrentUserCodySubscription.__mocked = true
                    console.log(
                        'Successfully mocked GraphQL getCurrentUserCodySubscription for Pro user'
                    )
                }

                // Mock getCurrentUserCodyProEnabled
                if (
                    originalGetCurrentUserCodyProEnabled &&
                    !originalGetCurrentUserCodyProEnabled.__mocked
                ) {
                    // Mock to return Pro user enabled status
                    graphqlClientModule.graphqlClient.getCurrentUserCodyProEnabled = async () => {
                        return {
                            codyProEnabled: true,
                        }
                    }
                    graphqlClientModule.graphqlClient.getCurrentUserCodyProEnabled.__mocked = true
                    console.log('Successfully mocked GraphQL getCurrentUserCodyProEnabled for Pro user')
                }
            }
        } catch (error) {
            console.warn('Failed to mock GraphQL client subscription method:', error)
        }
    }

    private mockAtModuleLevel(): void {
        try {
            // Mock at Node.js require cache level to intercept module loading
            const Module = require('node:module')
            const originalRequire = Module.prototype.require

            // Track if we've already wrapped the require function
            if (!originalRequire.__codyMocked) {
                Module.prototype.require = function (id: string, ...args: any[]) {
                    const result = originalRequire.apply(this, [id, ...args])

                    // Intercept userProductSubscription module
                    if (id.includes('userProductSubscription') && result) {
                        try {
                            // Create enhanced module with mocked utility functions
                            const mockSubscriptionData = { userCanUpgrade: false } // Pro user

                            // Only modify if properties are configurable
                            if (
                                result.currentUserProductSubscription &&
                                Object.getOwnPropertyDescriptor(result, 'currentUserProductSubscription')
                                    ?.configurable !== false
                            ) {
                                result.currentUserProductSubscription = async () => mockSubscriptionData
                            }

                            if (
                                result.cachedUserProductSubscription &&
                                Object.getOwnPropertyDescriptor(result, 'cachedUserProductSubscription')
                                    ?.configurable !== false
                            ) {
                                result.cachedUserProductSubscription = () => mockSubscriptionData
                            }

                            console.log(
                                'Successfully intercepted userProductSubscription module at require level'
                            )
                        } catch (moduleError) {
                            console.warn(
                                'Module-level mocking encountered non-configurable properties:',
                                moduleError
                            )
                        }
                    }

                    return result
                }

                // Mark as mocked to prevent double wrapping
                Module.prototype.require.__codyMocked = true
            }
        } catch (error) {
            console.warn('Module-level mocking failed:', error)
        }
    }

    private createObservableOverride(): void {
        try {
            // Import Observable and create a replacement pipeline
            const { Observable } = require('observable-fns')
            const mockSubscriptionData = { userCanUpgrade: false } // Pro user

            // Create a mock Observable that immediately emits Pro user data
            const mockObservable = Observable.of(mockSubscriptionData)

            // Try to access the userProductSubscription module after it may have been loaded
            setTimeout(() => {
                try {
                    const userProductSubscriptionModule = require('@sourcegraph/cody-shared/src/sourcegraph-api/userProductSubscription')

                    // Check if we can override the Observable (last resort)
                    const descriptor = Object.getOwnPropertyDescriptor(
                        userProductSubscriptionModule,
                        'userProductSubscription'
                    )
                    if (descriptor?.configurable) {
                        Object.defineProperty(userProductSubscriptionModule, 'userProductSubscription', {
                            get: () => mockObservable,
                            configurable: true,
                            enumerable: true,
                        })
                        console.log(
                            'Successfully created Observable override for userProductSubscription'
                        )
                    }
                } catch (observableError) {
                    // This is expected to fail in many cases - don't log as error
                    console.debug('Observable override not possible (expected):', observableError)
                }
            }, 100) // Small delay to allow module loading
        } catch (error) {
            console.warn('Observable override creation failed:', error)
        }
    }

    private mockGraphQLOperationsForTesting(): void {
        try {
            // Mock site version to prevent AbortError issues
            const graphqlClientModule = require('@sourcegraph/cody-shared/src/sourcegraph-api/graphql')
            if (graphqlClientModule?.graphqlClient) {
                const originalGetSiteVersion = graphqlClientModule.graphqlClient.getSiteVersion

                // Only mock if not already mocked
                if (originalGetSiteVersion && !originalGetSiteVersion.__mocked) {
                    graphqlClientModule.graphqlClient.getSiteVersion = async (signal?: AbortSignal) => {
                        // Return a mock version that works with dotcom
                        return '6.0.0'
                    }
                    // Mark as mocked to prevent double mocking
                    graphqlClientModule.graphqlClient.getSiteVersion.__mocked = true
                }
            }

            console.log('Successfully initialized GraphQL operation mocks')
        } catch (error) {
            console.warn('Failed to mock GraphQL operations:', error)
            console.warn(
                'Some operations may still fail with AbortError, but core functionality should work'
            )
        }
    }

    private mockModelPreferencesForTesting(): void {
        try {
            // Mock model preferences to eliminate endpoint dependency issues
            // This provides a static preference structure that supports model selection
            // while avoiding the trailing slash endpoint mismatch problems

            const localStorageInstance = localStorage as any
            if (localStorageInstance?._storage) {
                // Override only the model preference methods, preserving all other functionality
                const originalGetModelPreferences = localStorage.getModelPreferences.bind(localStorage)
                const originalSetModelPreferences = localStorage.setModelPreferences.bind(localStorage)

                // Check if already mocked to prevent double-mocking
                if (!(localStorage.getModelPreferences as any).__mocked) {
                    // Static mock preferences that work for common model selection scenarios
                    const mockPreferences = {
                        'https://sourcegraph.com/': {
                            defaults: {
                                chat: 'anthropic::2023-06-01::claude-3-5-sonnet-20241022',
                                edit: 'openai::2024-02-01::gpt-4o',
                                autocomplete: 'fireworks::v1::starcoder-hybrid',
                            },
                            selected: {},
                        },
                    }

                    localStorage.getModelPreferences = () => {
                        // Use stored preferences if they exist, otherwise return mock defaults
                        const stored = originalGetModelPreferences()
                        return Object.keys(stored).length > 0 ? stored : mockPreferences
                    }

                    localStorage.setModelPreferences = async preferences => {
                        // Allow setting preferences normally - this preserves user selections
                        return originalSetModelPreferences(preferences)
                    }

                    // Mark as mocked
                    ;(localStorage.getModelPreferences as any).__mocked = true
                    ;(localStorage.setModelPreferences as any).__mocked = true

                    console.log('Successfully mocked model preferences methods')
                }
            }
        } catch (error) {
            console.warn('Failed to mock model preferences:', error)
            console.warn('Model selection may still encounter endpoint dependency issues')
        }
    }

    // DISABLED: Real authentication method - permanently commented out
    /* private async validateAndUpdateAuthStatus(
        credentials: ResolvedConfigurationCredentialsOnly,
        signal?: AbortSignal,
        resetInitialAuthStatus?: boolean
    ): Promise<void> {
        if (resetInitialAuthStatus ?? true) {
            // Immediately emit the unauthenticated status while we are authenticating.
            // Emitting `authenticated: false` for a brief period is both true and a
            // way to ensure that subscribers are robust to changes in
            // authentication status.
            this.status.next({
                authenticated: false,
                pendingValidation: true,
                endpoint: credentials.auth.serverEndpoint,
            })
        }

        try {
            const authStatus = await validateCredentials(credentials, signal, undefined)
            signal?.throwIfAborted()
            this.status.next(authStatus)
            await this.handleAuthTelemetry(authStatus, signal)
        } catch (error) {
            if (!isAbortError(error)) {
                logError('AuthProvider', 'Unexpected error validating credentials', error)
            }
        }
    } */

    constructor(setAuthStatusObservable = setAuthStatusObservable_, resolvedConfig = resolvedConfig_) {
        // PERMANENT MOCK AUTHENTICATION - replaces all real authentication logic
        // Initialize mock auth immediately - will use fallback username if localStorage not ready
        this.initializeMockAuth()

        // Real authentication logic is permanently disabled
        // All code below is commented out to prevent real authentication
        /*
        setAuthStatusObservable(this.status.pipe(distinctUntilChanged()))

        const credentialsChangesNeedingValidation = resolvedConfig.pipe(
            withLatestFrom(this.lastValidatedAndStoredCredentials.pipe(startWith(null))),
            switchMap(([config, lastValidatedCredentials]) => {
                const credentials: ResolvedConfigurationCredentialsOnly =
                    toCredentialsOnlyNormalized(config)
                return isEqual(credentials, lastValidatedCredentials)
                    ? NEVER
                    : Observable.of(credentials)
            }),
            distinctUntilChanged()
        )

        this.subscriptions.push(
            ClientConfigSingleton.getInstance()
                .updates.pipe(
                    abortableOperation(async (config, signal) => {
                        const nextAuthStatus = await validateCredentials(
                            await currentResolvedConfig(),
                            signal,
                            config
                        )
                        // The only case where client config impacts the auth status is when the user is
                        // logged into dotcom but the client config is set to use an enterprise instance
                        // we explicitly check for this error and only update if so
                        if (
                            !nextAuthStatus.authenticated &&
                            isEnterpriseUserDotComError(nextAuthStatus.error)
                        ) {
                            this.status.next(nextAuthStatus)
                        }
                    })
                )
                .subscribe({})
        )

        // Perform auth as config changes.
        this.subscriptions.push(
            combineLatest(
                credentialsChangesNeedingValidation,
                this.refreshRequests.pipe(startWith(true))
            )
                .pipe(
                    abortableOperation(async ([config, resetInitialAuthStatus], signal) => {
                        if (getClientCapabilities().isCodyWeb) {
                            // Cody Web calls {@link AuthProvider.validateAndStoreCredentials}
                            // explicitly. This early exit prevents duplicate authentications during
                            // the initial load.
                            return
                        }
                        await this.validateAndUpdateAuthStatus(config, signal, resetInitialAuthStatus)
                    })
                )
                .subscribe({})
        )

        // Try to reauthenticate periodically when the authentication failed due to an availability
        // error (which is ephemeral and the underlying error condition may no longer exist).
        this.subscriptions.push(
            authStatus
                .pipe(
                    switchMap(authStatus => {
                        if (!authStatus.authenticated && isNeedsAuthChallengeError(authStatus.error)) {
                            // This interval is short because we want to quickly authenticate after
                            // the user successfully performs the auth challenge. If automatic auth
                            // refresh is expanded to include other conditions (such as any network
                            // connectivity gaps), it should probably have a longer interval, and we
                            // need to respect
                            // https://linear.app/sourcegraph/issue/CODY-3745/codys-background-periodic-network-access-causes-2fa.
                            const intervalMsec = 2500
                            return interval(intervalMsec)
                        }
                        return EMPTY
                    })
                )
                .subscribe(() => {
                    this.refreshRequests.next(false)
                })
        )

        // Keep context updated with auth status.
        this.subscriptions.push(
            authStatus.subscribe(authStatus => {
                try {
                    this.lastEndpoint = authStatus.endpoint
                    vscode.commands.executeCommand('authStatus.update', authStatus)
                    vscode.commands.executeCommand(
                        'setContext',
                        'cody.activated',
                        authStatus.authenticated
                    )
                    vscode.commands.executeCommand(
                        'setContext',
                        'cody.serverEndpoint',
                        authStatus.endpoint
                    )
                } catch (error) {
                    logError('AuthProvider', 'Unexpected error while setting context', error)
                }
            })
        )

        // Report auth changes.
        this.subscriptions.push(startAuthTelemetryReporter())

        this.subscriptions.push(
            disposableSubscription(
                vscode.commands.registerCommand('cody.auth.refresh', () => this.refresh())
            )
        )
        */
    }

    private async handleAuthTelemetry(authStatus: AuthStatus, signal?: AbortSignal): Promise<void> {
        // If the extension is authenticated on startup, it can't be a user's first
        // ever authentication. We store this to prevent logging first-ever events
        // for already existing users.
        const hasAuthed = this.hasAuthed
        this.hasAuthed = true
        if (!hasAuthed && authStatus.authenticated) {
            await this.setHasAuthenticatedBefore()
            signal?.throwIfAborted()
        } else if (authStatus.authenticated) {
            this.handleFirstEverAuthentication()
        }
    }

    public dispose(): void {
        for (const subscription of this.subscriptions) {
            subscription.unsubscribe()
        }
    }

    /**
     * Refresh the auth status.
     */
    public refresh(resetInitialAuthStatus = true): void {
        this.lastValidatedAndStoredCredentials.next(null)
        this.refreshRequests.next(resetInitialAuthStatus)
    }

    public signout(endpoint: string): void {
        if (this.lastEndpoint !== endpoint) {
            return
        }
        this.lastValidatedAndStoredCredentials.next(null)
        this.status.next({
            authenticated: false,
            endpoint: DOTCOM_URL.toString(),
            pendingValidation: false,
        })
    }

    public async validateAndStoreCredentials(
        config: ResolvedConfigurationCredentialsOnly | AuthCredentials,
        mode: 'store-if-valid' | 'always-store'
    ): Promise<AuthStatus> {
        let credentials: ResolvedConfigurationCredentialsOnly
        if ('auth' in config) {
            credentials = toCredentialsOnlyNormalized(config)
        } else {
            const prevConfig = await currentResolvedConfig()
            credentials = toCredentialsOnlyNormalized({
                configuration: prevConfig.configuration,
                auth: config,
                clientState: prevConfig.clientState,
            })
        }

        const authStatus = await validateCredentials(credentials, undefined)
        const shouldStore = mode === 'always-store' || authStatus.authenticated
        if (shouldStore) {
            await Promise.all([
                localStorage.saveEndpointAndToken(credentials.auth),
                this.serializeUninstallerInfo(authStatus),
            ])
            this.lastValidatedAndStoredCredentials.next(credentials)
            this.status.next(authStatus)
        }
        if (!shouldStore) {
            // Always report telemetry even if we don't store it.
            // reportAuthTelemetryEvent(authStatus) // DISABLED: Mock auth doesn't need telemetry
        }
        await this.handleAuthTelemetry(authStatus, undefined)
        return authStatus
    }

    public setAuthPendingToEndpoint(endpoint: string): void {
        // TODO(sqs)#observe: store this pending endpoint in clientState instead of authStatus
        this.status.next({ authenticated: false, endpoint, pendingValidation: true })
    }

    // Logs a telemetry event if the user has never authenticated to Sourcegraph.
    private handleFirstEverAuthentication(): void {
        if (localStorage.get(HAS_AUTHENTICATED_BEFORE_KEY)) {
            // User has authenticated before, noop
            return
        }

        this.setHasAuthenticatedBefore()
    }

    private setHasAuthenticatedBefore() {
        return localStorage.set(HAS_AUTHENTICATED_BEFORE_KEY, 'true')
    }

    // When the auth status is updated, we serialize the current configuration to disk,
    // so that it can be sent with Telemetry when the post-uninstall script runs.
    // we only write on auth change as that is the only significantly important factor
    // and we don't want to write too frequently (so we don't react to config changes)
    // The vscode API is not available in the post-uninstall script.
    // Public so that it can be mocked for testing
    public async serializeUninstallerInfo(authStatus: AuthStatus): Promise<void> {
        if (!authStatus.authenticated) return
        let clientCapabilities: ClientCapabilitiesWithLegacyFields | undefined
        try {
            clientCapabilities = getClientCapabilities()
        } catch {
            // If client capabilities cannot be retrieved, we will just synthesize
            // them from defaults in the post-uninstall script.
        }
        // TODO: put this behind a proper client capability if any other IDE's need to uninstall
        // the same way as VSCode (most editors have a proper uninstall hook)
        if (clientCapabilities?.isVSCode) {
            const config = localStorage.getConfig() ?? (await currentResolvedConfig())
            await serializeConfigSnapshot({
                config,
                authStatus,
                clientCapabilities,
                version,
            })
        }
    }
}

export const authProvider = new AuthProvider()

/**
 * @internal For testing only.
 */
export function newAuthProviderForTest(
    ...args: ConstructorParameters<typeof AuthProvider>
): AuthProvider {
    return new AuthProvider(...args)
}

// DISABLED: Real auth telemetry - permanently commented out
/* function startAuthTelemetryReporter(): Unsubscribable {
    return authStatus.subscribe(authStatus => {
        // reportAuthTelemetryEvent(authStatus)
    })
} */

// DISABLED: Real auth telemetry event reporting - permanently commented out
/* function reportAuthTelemetryEvent(authStatus: AuthStatus): void {
    if (authStatus.pendingValidation) {
        return // Not a valid event to report.
    }

    if (
        !authStatus.authenticated &&
        (isAvailabilityError(authStatus.error) || isInvalidAccessTokenError(authStatus.error))
    ) {
    } else if (authStatus.authenticated) {
    } else {
    }
} */
function toCredentialsOnlyNormalized(
    config: ResolvedConfiguration | ResolvedConfigurationCredentialsOnly
): ResolvedConfigurationCredentialsOnly {
    return {
        configuration: {
            customHeaders: config.configuration.customHeaders,
        },
        auth: { ...config.auth, serverEndpoint: normalizeServerEndpointURL(config.auth.serverEndpoint) },
        clientState: { anonymousUserID: config.clientState.anonymousUserID },
    }
}
