import {
    CodyAutoSuggestionMode,
    FeatureFlag,
    currentAuthStatus,
    currentResolvedConfig,
    currentUserProductSubscription,
    featureFlagProvider,
    storeLastValue,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import { localStorage } from '../services/LocalStorageProvider'
import { isUserEligibleForAutoeditsFeature } from './create-autoedits-provider'

export class AutoEditBetaOnboarding implements vscode.Disposable {
    private featureFlagAutoEditExperimental = storeLastValue(
        featureFlagProvider.evaluatedFeatureFlag(FeatureFlag.CodyAutoEditExperimentEnabledFeatureFlag)
    )

    public async enrollUserToAutoEditBetaIfEligible(): Promise<void> {
        const isUserEligibleForAutoeditBeta = await this.isUserEligibleForAutoeditBetaOverride()
        if (isUserEligibleForAutoeditBeta) {
            await this.enrollUserToAutoEditBeta()
        }
    }

    public async suggestToEnrollUserToAutoEditBetaIfEligible(): Promise<void> {
        const isUserEligibleForAutoeditBeta = await this.isUserEligibleForAutoeditBetaOverride()
        if (isUserEligibleForAutoeditBeta) {
            vscode.window
                .showInformationMessage(
                    'Auto-edits are now available',
                    {
                        detail: '<html>An advanced mode for completions is now available. This is configured via <b>cody_settings.json</b>, give it a try now.</html>',
                    },
                    'Configure auto-edits',
                    'Open cody__settings.json'
                )
                .then(answer => {
                    if (answer === 'Configure auto-edits') {
                        vscode.workspace
                            .getConfiguration()
                            .update(
                                'cody.suggestions.mode',
                                CodyAutoSuggestionMode.Autoedit,
                                vscode.ConfigurationTarget.Global
                            )
                    } else if (answer === 'Open cody__settings.json') {
                        vscode.commands.executeCommand('cody.settings.extension')
                    }
                })
        }
    }

    private async enrollUserToAutoEditBeta(): Promise<void> {
        const switchToAutocompleteText = 'Switch to autocomplete'

        await vscode.workspace
            .getConfiguration()
            .update(
                'cody.suggestions.mode',
                CodyAutoSuggestionMode.Autoedit,
                vscode.ConfigurationTarget.Global
            )
        // Set Enroll to true in local storage so that we don't override the setting if the user changes it
        this.markUserAsAutoEditBetaEnrolled()

        const selection = await vscode.window.showInformationMessage(
            'You have been enrolled to Cody Auto-edit! Cody will intelligently suggest next edits as you navigate the codebase.',
            switchToAutocompleteText
        )

        if (selection === switchToAutocompleteText) {
            // Enable the setting programmatically
            await vscode.workspace
                .getConfiguration()
                .update(
                    'cody.suggestions.mode',
                    CodyAutoSuggestionMode.Autocomplete,
                    vscode.ConfigurationTarget.Global
                )
        }
    }

    private async isUserEligibleForAutoeditBetaOverride(): Promise<boolean> {
        const isAutoEditEnabled = await this.isAutoEditEnabled()
        if (isAutoEditEnabled) {
            // If auto-edit has been enabled, we don't need to show the onboarding and mark
            // the user as enrolled
            this.markUserAsAutoEditBetaEnrolled()
            return false
        }
        const isUserEligible = await this.isUserEligibleForAutoEditFeature()
        if (!isUserEligible) {
            return false
        }
        // If a user have already been enrolled to auto edit beta, don't show the onboarding again
        const isAlreadyBetaEnrolled = await localStorage.isAutoEditBetaEnrolled()
        if (isAlreadyBetaEnrolled) {
            return false
        }
        return true
    }

    private async isAutoEditEnabled(): Promise<boolean> {
        const config = await currentResolvedConfig()
        return config.configuration.experimentalAutoEditEnabled
    }

    public markUserAsAutoEditBetaEnrolled(): Promise<void> {
        return localStorage.setAutoeditBetaEnrollment()
    }

    private async isUserEligibleForAutoEditFeature(): Promise<boolean> {
        if (process.env.CODY_TESTING === 'true') {
            return false
        }
        const authStatus = currentAuthStatus()
        const productSubscription = await currentUserProductSubscription()
        const autoEditFeatureFlag = this.isAutoEditFeatureFlagEnabled()
        const { isUserEligible } = isUserEligibleForAutoeditsFeature(
            autoEditFeatureFlag,
            authStatus,
            productSubscription
        )
        return isUserEligible
    }

    private isAutoEditFeatureFlagEnabled(): boolean {
        return !!this.featureFlagAutoEditExperimental.value.last
    }

    dispose(): void {
        this.featureFlagAutoEditExperimental.subscription.unsubscribe()
    }
}

export const autoeditsOnboarding = new AutoEditBetaOnboarding()
