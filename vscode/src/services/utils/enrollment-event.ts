import type { FeatureFlag } from '@sourcegraph/cody-shared'
import { localStorage } from '../LocalStorageProvider'

/**
 * Logs the enrollment event for the given feature flag ONCE in user's lifetime
 * based on the feature flag key stored in the local storage.
 * NOTE: Update the `getFeatureFlagEventName` function to add new feature flags.
 * Returns true if the user has already been enrolled in the experiment.
 *
 * @param key The feature flag key.
 * @param isEnabled Whether the user has the feature flag enabled or not.
 */
export function logFirstEnrollmentEvent(key: FeatureFlag, isEnabled: boolean): boolean {
    // Check if the user is already enrolled in the experiment or not
    const isEnrolled = localStorage.getEnrollmentHistory(key)
    // We only want to log the enrollment event once in the user's lifetime.

    return isEnrolled
}
