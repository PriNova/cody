import type { AuthMethod } from '../chat/protocol'

// An auth provider for simplified onboarding. This is a sidecar to AuthProvider
// so we can deprecate the experiment later. AuthProviderSimplified only works
// for dotcom, and doesn't work on VScode web. See LoginSimplified.

export class AuthProviderSimplified {
    public async openExternalAuthUrl(method: AuthMethod, tokenReceiverUrl?: string): Promise<boolean> {
        // Bypass external auth - always return success for BYOK mode
        return true
    }
}
