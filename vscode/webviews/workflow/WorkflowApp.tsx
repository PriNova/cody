import { ReactFlowProvider } from '@xyflow/react'
import type React from 'react'
import '../index.css'
import type { GenericVSCodeWrapper } from '@sourcegraph/cody-shared'
import { Flow } from './components/Flow'
import type { ExtensionToWorkflow, WorkflowToExtension } from './services/WorkflowProtocol'

export const WorkflowApp: React.FC<{
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, ExtensionToWorkflow>
}> = vscodeAPI => {
    return (
        <ReactFlowProvider>
            <Flow {...vscodeAPI} />
        </ReactFlowProvider>
    )
}
