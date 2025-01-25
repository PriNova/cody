import type { Model } from '@sourcegraph/cody-shared'
import type { Edge } from '../components/CustomOrderedEdge'
import type { WorkflowNodes } from '../components/nodes/Nodes'
/**
 * Workflow extension communication protocol types.
 *
 * WorkflowToExtension: Messages sent from the webview to the VS Code extension
 * - save_workflow: Request to save current workflow
 * - load_workflow: Request to load a workflow
 * - execute_workflow: Request to execute current workflow
 *
 * WorkflowFromExtension: Messages sent from the VS Code extension to the webview
 * - workflow_loaded: Response after loading workflow
 * - execution_started: Workflow execution has started
 * - execution_completed: Workflow execution has completed
 * - node_execution_status: Status update for individual node execution
 */

interface BaseWorkflowMessage {
    type: string
}

interface WorkflowPayload {
    nodes?: WorkflowNodes[]
    edges?: Edge[]
}

interface NodeExecutionPayload {
    nodeId: string
    status: 'running' | 'completed' | 'error' | 'interrupted' | 'pending_approval'
    result?: string
    command?: string
}

// Messages TO Extension (Commands)
interface OpenExternalLink extends BaseWorkflowMessage {
    type: 'open_external_link'
    url: string
}

interface SaveWorkflowCommand extends BaseWorkflowMessage {
    type: 'save_workflow'
    data: WorkflowPayload
}

interface LoadWorkflowCommand extends BaseWorkflowMessage {
    type: 'load_workflow'
}

interface ExecuteWorkflowCommand extends BaseWorkflowMessage {
    type: 'execute_workflow'
    data: WorkflowPayload
}

interface AbortWorkflowCommand extends BaseWorkflowMessage {
    type: 'abort_workflow'
}
interface GetModelsCommand extends BaseWorkflowMessage {
    type: 'get_models'
}

// Messages FROM Extension (Events)
interface WorkflowLoadedEvent extends BaseWorkflowMessage {
    type: 'workflow_loaded'
    data: WorkflowPayload
}

interface ExecutionStartedEvent extends BaseWorkflowMessage {
    type: 'execution_started'
}

interface ExecutionCompletedEvent extends BaseWorkflowMessage {
    type: 'execution_completed'
}

interface NodeExecutionStatusEvent extends BaseWorkflowMessage {
    type: 'node_execution_status'
    data: NodeExecutionPayload
}

interface CalculateTokensCommand extends BaseWorkflowMessage {
    type: 'calculate_tokens'
    data: {
        text: string
        nodeId: string
    }
}

interface TokenCountEvent extends BaseWorkflowMessage {
    type: 'token_count'
    data: {
        count: number
        nodeId: string
    }
}

interface NodeApprovalCommand extends BaseWorkflowMessage {
    type: 'node_approved'
    data: {
        nodeId: string
        modifiedCommand?: string
    }
}

interface ModelsLoadedEvent extends BaseWorkflowMessage {
    type: 'models_loaded'
    data: Model[]
}

// Export discriminated unions
export type WorkflowToExtension =
    | OpenExternalLink
    | GetModelsCommand
    | SaveWorkflowCommand
    | LoadWorkflowCommand
    | ExecuteWorkflowCommand
    | AbortWorkflowCommand
    | CalculateTokensCommand
    | NodeApprovalCommand

export type ExtensionToWorkflow =
    | ModelsLoadedEvent
    | WorkflowLoadedEvent
    | ExecutionStartedEvent
    | ExecutionCompletedEvent
    | NodeExecutionStatusEvent
    | TokenCountEvent
