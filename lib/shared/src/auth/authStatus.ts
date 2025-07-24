import { Observable } from 'observable-fns'
import {
    distinctUntilChanged,
    firstValueFrom,
    fromLateSetSource,
    shareReplay,
    storeLastValue,
} from '../misc/observable'
import { skipPendingOperation } from '../misc/observableOperation'
import { isDotCom } from '../sourcegraph-api/environments'
import type { PartialDeep } from '../utils'
import {
    AUTH_STATUS_FIXTURE_AUTHED_DOTCOM,
    type AuthStatus,
    type AuthenticatedAuthStatus,
} from './types'

const _authStatus = fromLateSetSource<AuthStatus>()

let hasSetAuthStatusObservable = false

/**
 * Set the observable that will be used to provide the global {@link authStatus}. This should be
 * set exactly once.
 */
export function setAuthStatusObservable(input: Observable<AuthStatus>): void {
    if (hasSetAuthStatusObservable) {
        throw new Error('setAuthStatusObservable must be called exactly once total')
    }
    hasSetAuthStatusObservable = true
    _authStatus.setSource(input.pipe(distinctUntilChanged()))
}

/**
 * The auth status.
 *
 * It is intentionally global because the auth status is global.
 *
 * It is OK to access this before {@link setAuthStatusObservable} is called, but it will
 * not emit any values before then.
 */
export const authStatus: Observable<AuthStatus> = _authStatus.observable.pipe(shareReplay())

const { value: syncValue, subscription: syncValueSubscription } = storeLastValue(authStatus)

/**
 * The current auth status. Callers should use {@link authStatus} instead so that they react to
 * changes. This function is provided for old call sites that haven't been updated to use an
 * Observable.
 *
 * Callers should take care to avoid race conditions and prefer observing {@link authStatus}.
 *
 * Throws if the auth status is not yet ready; see {@link statusOrNotReadyYet}.
 */
export function currentAuthStatus(): AuthStatus {
    if (!syncValue.isSet) {
        throw new Error('AuthStatus is not initialized')
    }
    return syncValue.last
}

/**
 * Like {@link currentAuthStatus}, but throws if unauthenticated.
 *
 * Callers should take care to avoid race conditions and prefer observing {@link authStatus}.
 */
export function currentAuthStatusAuthed(): AuthenticatedAuthStatus {
    const authStatus = currentAuthStatus()
    if (!authStatus.authenticated) {
        throw new Error('Not authenticated')
    }
    return authStatus
}

/** Like {@link currentAuthStatus}, but does NOT throw if not ready. */
export function currentAuthStatusOrNotReadyYet(): AuthStatus | undefined {
    return syncValue.last
}

export function firstNonPendingAuthStatus(): Promise<AuthStatus> {
    return firstValueFrom(
        Observable.from(authStatus)
            .pipe(skipPendingOperation())
            .filter(status => !status.pendingValidation)
    )
}

/**
 * Whether a user is authenticated on DotCom.
 */
export function isDotComAuthed(): boolean {
    const authStatus = currentAuthStatusOrNotReadyYet()
    return Boolean(authStatus?.authenticated && isDotCom(authStatus))
}

/**
 * Mock the {@link authStatus} and {@link currentAuthStatus} values.
 * Uses {@link AUTH_STATUS_FIXTURE_AUTHED_DOTCOM} as an auth status by default.
 *
 * For use in tests only.
 */
export function mockAuthStatus(
    value: PartialDeep<AuthStatus> | Observable<AuthStatus> = AUTH_STATUS_FIXTURE_AUTHED_DOTCOM
): void {
    if (value instanceof Observable) {
        _authStatus.setSource(value, false)
        return
    }
    _authStatus.setSource(Observable.of(value as AuthStatus), false)
    Object.assign(syncValue, { last: value, isSet: true })
    syncValueSubscription.unsubscribe()
}

/**
 * Interface for localStorage provider that can provide anonymous user ID
 */
interface LocalStorageProvider {
    anonymousUserID(): string
}

/**
 * Mock the {@link authStatus} with a custom AuthStatus that uses localStorage for username.
 *
 * Creates an authenticated user with:
 * - endpoint: 'https://sourcegraph.com' (fixed)
 * - authenticated: true (always)
 * - username: Retrieved from localStorage 'sourcegraphAnonymousUid' or 'anonymous' fallback
 * - pendingValidation: false
 *
 * This prevents any GraphQL backend calls while providing a realistic auth state.
 *
 * @param localStorageProvider Optional localStorage provider for dependency injection
 *
 * For use in tests only.
 */
export function mockLocalStorageAuthStatus(localStorageProvider?: LocalStorageProvider): void {
    let username = 'anonymous'
    let displayName: string | undefined
    let primaryEmail: string | undefined
    let avatarURL: string | undefined

    // Try to get username and cached profile data from localStorage if available (in test environments)
    try {
        if (localStorageProvider) {
            // Use provided localStorage provider (for explicit dependency injection)
            username = localStorageProvider.anonymousUserID() || 'anonymous'
        } else {
            // Access localStorage from global scope if available (set up in test environment)
            const globalLocalStorage = (globalThis as any).localStorage
            if (globalLocalStorage?.anonymousUserID) {
                username = globalLocalStorage.anonymousUserID() || 'anonymous'
            } else {
                // Try to access browser localStorage API as fallback
                const storageKey = 'sourcegraphAnonymousUid'
                if (typeof window !== 'undefined' && window.localStorage) {
                    username = window.localStorage.getItem(storageKey) || 'anonymous'

                    // Try to retrieve cached profile data to maintain UI continuity
                    const cachedDisplayName = window.localStorage.getItem('cody-user-displayName')
                    const cachedPrimaryEmail = window.localStorage.getItem('cody-user-primaryEmail')
                    const cachedAvatarURL = window.localStorage.getItem('cody-user-avatarURL')

                    displayName = cachedDisplayName || undefined
                    primaryEmail = cachedPrimaryEmail || undefined
                    avatarURL = cachedAvatarURL || undefined
                }
            }
        }
    } catch (error) {
        // Fallback to 'anonymous' if localStorage is not available
        console.warn('localStorage not available, using anonymous username:', error)
    }

    // Enhanced AuthStatus with all fields needed for full UI functionality
    const customAuthStatus: AuthenticatedAuthStatus = {
        endpoint: 'https://sourcegraph.com',
        authenticated: true,
        username,
        displayName: displayName || username, // Fallback to username if no displayName cached
        primaryEmail: primaryEmail || `${username}@example.com`, // Generate fallback email
        avatarURL, // May be undefined, UI handles this gracefully
        pendingValidation: false,
        hasVerifiedEmail: true, // Assume verified for mock
        requiresVerifiedEmail: false, // Don't require verification in mock
        isFireworksTracingEnabled: false, // Disable tracing in mock
        rateLimited: false, // No rate limiting in mock
        organizations: [], // Empty organizations array for dotcom users
    }

    mockAuthStatus(customAuthStatus)
}

/**
 * Mock userProductSubscription for testing UI components that depend on Pro user status.
 * This mocks the subscription observable to return Pro user status (userCanUpgrade: false).
 *
 * For use in tests only.
 */
export function mockUserProductSubscriptionAsPro(): void {
    try {
        // Strategy 1: Mock the GraphQL client method that provides subscription data
        const graphqlClientModule = require('../sourcegraph-api/graphql')
        if (graphqlClientModule?.graphqlClient) {
            const originalGetCurrentUserCodySubscription =
                graphqlClientModule.graphqlClient.getCurrentUserCodySubscription

            // Only mock if not already mocked
            if (
                originalGetCurrentUserCodySubscription &&
                !originalGetCurrentUserCodySubscription.__mocked
            ) {
                graphqlClientModule.graphqlClient.getCurrentUserCodySubscription = async (
                    signal?: AbortSignal
                ) => {
                    // Return Pro subscription data
                    return {
                        plan: 'PRO',
                        status: 'ACTIVE',
                    }
                }
                // Mark as mocked to prevent double mocking
                graphqlClientModule.graphqlClient.getCurrentUserCodySubscription.__mocked = true
            }
        }

        // Strategy 2: Mock the cached subscription functions for immediate UI updates
        const userProductSubscriptionModule = require('../sourcegraph-api/userProductSubscription')

        // Mock the currentUserProductSubscription function
        if (userProductSubscriptionModule.currentUserProductSubscription) {
            const originalCurrentUserProductSubscription =
                userProductSubscriptionModule.currentUserProductSubscription
            if (!originalCurrentUserProductSubscription.__mocked) {
                userProductSubscriptionModule.currentUserProductSubscription = async () => {
                    return { userCanUpgrade: false } // Pro user cannot upgrade
                }
                userProductSubscriptionModule.currentUserProductSubscription.__mocked = true
            }
        }

        // Mock the cachedUserProductSubscription function
        if (userProductSubscriptionModule.cachedUserProductSubscription) {
            const originalCachedUserProductSubscription =
                userProductSubscriptionModule.cachedUserProductSubscription
            if (!originalCachedUserProductSubscription.__mocked) {
                userProductSubscriptionModule.cachedUserProductSubscription = () => {
                    return { userCanUpgrade: false } // Pro user cannot upgrade
                }
                userProductSubscriptionModule.cachedUserProductSubscription.__mocked = true
            }
        }

        // Strategy 3: Mock the Observable immediately to never return pendingOperation
        try {
            const { Observable } = require('observable-fns')
            const mockSubscriptionData = { userCanUpgrade: false } // Pro user cannot upgrade

            // Create a mock Observable that immediately emits Pro user data
            const mockObservable = Observable.of(mockSubscriptionData)

            // Override the userProductSubscription Observable export immediately
            const userProductSubscriptionModule = require('../sourcegraph-api/userProductSubscription')

            // Force override the Observable export regardless of configurability
            try {
                Object.defineProperty(userProductSubscriptionModule, 'userProductSubscription', {
                    value: mockObservable,
                    writable: false,
                    enumerable: true,
                    configurable: true,
                })
            } catch (valueError) {
                // Try getter approach if value approach fails
                try {
                    Object.defineProperty(userProductSubscriptionModule, 'userProductSubscription', {
                        get: () => {
                            return mockObservable
                        },
                        configurable: true,
                        enumerable: true,
                    })
                } catch (getterError) {
                    // Both value and getter override approaches failed
                }
            }
        } catch (observableError) {
            // Observable override failed
        }

        // Strategy 4: Also do delayed override as fallback
        setTimeout(() => {
            try {
                const { Observable } = require('observable-fns')
                const mockSubscriptionData = { userCanUpgrade: false }
                const mockObservable = Observable.of(mockSubscriptionData)
                const userProductSubscriptionModule = require('../sourcegraph-api/userProductSubscription')

                // Force replace the export
                userProductSubscriptionModule.userProductSubscription = mockObservable
            } catch (delayedError) {
                // Delayed override failed
            }
        }, 50) // Even smaller delay for immediate effect
    } catch (error) {
        console.warn('Failed to mock userProductSubscription:', error)
        console.warn('Some UI components may not receive correct subscription data')
    }
}

/**
 * Mock userProductSubscription for testing UI components with Free user status.
 * This mocks the subscription observable to return Free user status (userCanUpgrade: true).
 *
 * For use in tests only.
 */
export function mockUserProductSubscriptionAsFree(): void {
    try {
        // Import the userProductSubscription module dynamically
        const userProductSubscriptionModule = require('../sourcegraph-api/userProductSubscription')
        const { Observable } = require('observable-fns')

        // Mock the userProductSubscription observable to return Free user status
        const freeSubscription = { userCanUpgrade: true }

        // Create a spy that returns an Observable with Free subscription data
        const mockObservable = Observable.of(freeSubscription)

        // Check if property already exists and its descriptor
        const descriptor = Object.getOwnPropertyDescriptor(
            userProductSubscriptionModule,
            'userProductSubscription'
        )

        // Handle the case where the property is a const export (getter-only)
        if (descriptor?.get && !descriptor.set) {
            // Property is a getter-only (const export), we need to replace the getter
            try {
                Object.defineProperty(userProductSubscriptionModule, 'userProductSubscription', {
                    get: () => mockObservable,
                    configurable: true,
                    enumerable: true,
                })
            } catch (getterError) {
                console.warn('Cannot override getter-only userProductSubscription:', getterError)
                console.warn('UI components may not receive correct subscription data')
                return
            }
        } else if (!descriptor || descriptor.configurable) {
            // Property doesn't exist or is configurable, safe to define
            try {
                Object.defineProperty(userProductSubscriptionModule, 'userProductSubscription', {
                    get: () => mockObservable,
                    configurable: true,
                    enumerable: true,
                })
            } catch (defineError) {
                console.warn('Failed to define userProductSubscription property:', defineError)
                return
            }
        } else {
            // Property exists but is not configurable, cannot mock
            console.warn('userProductSubscription property exists but is not configurable, cannot mock')
            console.warn('UI components may not receive correct subscription data')
            return
        }
    } catch (error) {
        console.warn('Failed to mock userProductSubscription:', error)
        console.warn('This may be expected in environments where the module is not available')
    }
}

/**
 * Complete mock setup for full UI functionality - combines authentication and subscription mocking.
 * This is the recommended function to use for testing UI components that require both
 * authentication state and subscription status.
 *
 * @param options Configuration options for the mock
 * @param options.userType Whether to mock as 'pro' or 'free' user (default: 'pro')
 * @param options.localStorageProvider Optional localStorage provider for dependency injection
 *
 * For use in tests only.
 */
export function mockCompleteAuthForUI(
    options: {
        userType?: 'pro' | 'free'
        localStorageProvider?: LocalStorageProvider
    } = {}
): void {
    const { userType = 'pro', localStorageProvider } = options

    // Mock the authentication status with full AuthStatus fields
    mockLocalStorageAuthStatus(localStorageProvider)

    // Mock the subscription status based on userType
    if (userType === 'pro') {
        mockUserProductSubscriptionAsPro()
    } else {
        mockUserProductSubscriptionAsFree()
    }
}

/**
 * Save user profile data to localStorage for preservation across authentication mocking.
 * This allows the mock to restore previously cached user data for UI continuity.
 *
 * @param profileData User profile data to cache
 * @param profileData.displayName User's display name
 * @param profileData.primaryEmail User's primary email address
 * @param profileData.avatarURL URL to user's avatar image
 *
 * For use in tests only.
 */
export function saveProfileDataToLocalStorage(profileData: {
    displayName?: string
    primaryEmail?: string
    avatarURL?: string
}): void {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            if (profileData.displayName) {
                window.localStorage.setItem('cody-user-displayName', profileData.displayName)
            }
            if (profileData.primaryEmail) {
                window.localStorage.setItem('cody-user-primaryEmail', profileData.primaryEmail)
            }
            if (profileData.avatarURL) {
                window.localStorage.setItem('cody-user-avatarURL', profileData.avatarURL)
            }
        }
    } catch (error) {
        console.warn('Failed to save profile data to localStorage:', error)
    }
}
