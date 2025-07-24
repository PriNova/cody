import { Observable } from 'observable-fns'
import type { pendingOperation } from '../misc/observableOperation'

export interface UserProductSubscription {
    // TODO(sqs): this is the only field related to the user's subscription we were using previously
    // in AuthStatus, so start with just it and we can add more.

    /**
     * Whether the user is on Cody Free (i.e., can upgrade to Cody Pro). This is `false` for
     * enterprise users because they already have a higher degree of access than Cody Free/Pro.
     *
     * It's used to customize rate limit messages and show upgrade buttons in the UI.
     */
    userCanUpgrade: boolean
}

/**
 * Observe the currently authenticated user's Cody subscription status (for Sourcegraph.com Cody
 * Free/Pro users only).
 */
// TEMPORARY MOCK: Always return Pro user data to avoid pendingOperation blocking model loading
// Original implementation commented out to avoid pendingOperation blocking model loading
/*
const originalUserProductSubscription: Observable<
    UserProductSubscription | null | typeof pendingOperation
> = authStatus.pipe(
    pick('authenticated', 'endpoint', 'pendingValidation'),
    debounceTime(0),
    switchMapReplayOperation(
        (authStatus): Observable<UserProductSubscription | Error | null | typeof pendingOperation> => {
            if (authStatus.pendingValidation) {
                return Observable.of(pendingOperation)
            }

            if (!authStatus.authenticated) {
                return Observable.of(null)
            }

            if (!isDotCom(authStatus)) {
                return Observable.of(null)
            }

            return promiseFactoryToObservable(signal =>
                graphqlClient.getCurrentUserCodySubscription(signal)
            ).pipe(
                map((sub): UserProductSubscription | null | typeof pendingOperation => {
                    if (isError(sub)) {
                        logError(
                            'userProductSubscription',
                            `Failed to get the Cody product subscription info from ${authStatus.endpoint}: ${sub}`
                        )
                        return null
                    }
                    const isActiveProUser =
                        sub !== null && 'plan' in sub && sub.plan === 'PRO' && sub.status !== 'PENDING'
                    return {
                        userCanUpgrade: !isActiveProUser,
                    }
                })
            )
        }
    ),
    map(result => (isError(result) ? null : result)) // the operation catches its own errors, so errors will never get here
)
*/

// MOCK: Export an Observable that immediately returns Pro user data
const mockSubscriptionData = { userCanUpgrade: false } // Pro user cannot upgrade
export const userProductSubscription: Observable<
    UserProductSubscription | null | typeof pendingOperation
> = Observable.of(mockSubscriptionData)

// Commented out since we're using mocked functions
// const userProductSubscriptionStorage = storeLastValue(userProductSubscription)

/**
 * Get the current user's product subscription info. If authentication is pending, it awaits
 * successful authentication.
 */
export function currentUserProductSubscription(): Promise<UserProductSubscription | null> {
    // MOCK: Always return Pro user data immediately
    return Promise.resolve({ userCanUpgrade: false })
}

/**
 * Check if the user is an enterprise user.
 */
export async function checkIfEnterpriseUser(): Promise<boolean> {
    // MOCK: Always return false (we're simulating a dotcom user)
    return false
}

/**
 * Get the current user's last-known product subscription info. Using this introduce a race
 * condition if auth is pending.
 */
export function cachedUserProductSubscription(): UserProductSubscription | null {
    // MOCK: Always return Pro user data immediately
    return { userCanUpgrade: false }
}
