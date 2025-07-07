import {
    CodyIDE,
    mockClientCapabilities,
    nextTick,
    setAuthStatusObservable,
    setStaticResolvedConfigurationValue,
} from '@sourcegraph/cody-shared'
import { Observable } from 'observable-fns'
import { createUninstallMarker } from './reinstall'
import { deleteUninstallerConfig, readConfig } from './serializeConfig'

async function main() {
    const uninstaller = await readConfig()
    if (uninstaller) {
        const { config, authStatus, version, clientCapabilities } = uninstaller
        if (config && authStatus) {
            try {
                setStaticResolvedConfigurationValue(config)
            } catch (error) {
                console.error('Failed to set config', error)
            }
            try {
                setAuthStatusObservable(Observable.of(authStatus))
            } catch (error) {
                console.error('Failed to set auth status', error)
            }
            // Wait for `currentAuthStatusOrNotReadyYet` to have this value synchronously.
            await nextTick()
            mockClientCapabilities(
                clientCapabilities ?? {
                    agentIDE: CodyIDE.VSCode,
                    isVSCode: true,
                    isCodyWeb: false,
                    agentExtensionVersion: version,
                    // Unused by TelemetryRecorderProvider
                    agentIDEVersion: '',
                    telemetryClientName: `${CodyIDE.VSCode}.Cody`,
                }
            )

            // cleanup the uninstaller config
            await deleteUninstallerConfig()
            await createUninstallMarker()
        }
    }
}

main()
