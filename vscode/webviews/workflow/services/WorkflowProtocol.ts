import type { Edge } from '../components/CustomOrderedEdge'
import type { WorkflowNode } from '../components/nodes/Nodes'
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
    nodes?: WorkflowNode[]
    edges?: Edge[]
}

interface NodeExecutionPayload {
    nodeId: string
    status: 'running' | 'completed' | 'error' | 'interrupted'  | 'pending_approval'
    result?: string
    command?: string
}

// Messages TO Extension (Commands)
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
    }
}

// Export discriminated unions
export type WorkflowToExtension =
    | SaveWorkflowCommand
    | LoadWorkflowCommand
    | ExecuteWorkflowCommand
    | AbortWorkflowCommand
    | CalculateTokensCommand
    | NodeApprovalCommand

export type WorkflowFromExtension =
    | WorkflowLoadedEvent
    | ExecutionStartedEvent
    | ExecutionCompletedEvent
    | NodeExecutionStatusEvent
    | TokenCountEvent
