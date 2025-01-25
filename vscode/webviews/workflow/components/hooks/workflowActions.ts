import type { GenericVSCodeWrapper } from '@sourcegraph/cody-shared'
import { useCallback } from 'react'
import type { ExtensionToWorkflow, WorkflowToExtension } from '../../services/WorkflowProtocol'
import type { Edge } from '../CustomOrderedEdge'
import { NodeType, type WorkflowNodes } from '../nodes/Nodes'

/**
 * Hook for managing workflow actions and interactions with VSCode extension.
 * @param {GenericVSCodeWrapper<WorkflowToExtension, ExtensionToWorkflow>} vscodeAPI - VSCode API wrapper for communication
 * @param {WorkflowNodes[]} nodes - Array of workflow nodes
 * @param {Edge[]} edges - Array of edges connecting workflow nodes
 * @param {React.Dispatch<React.SetStateAction<string | null>>} setPendingApprovalNodeId - State setter for pending approval node ID
 * @param {React.Dispatch<React.SetStateAction<Map<string, string>>>} setNodeErrors - State setter for node errors
 * @param {React.Dispatch<React.SetStateAction<boolean>>} setIsExecuting - State setter for execution status
 * @returns {{ onSave: () => void, onLoad: () => void, calculatePreviewNodeTokens: (nodes: WorkflowNodes[]) => void, handleNodeApproval: (nodeId: string, approved: boolean, modifiedCommand?: string) => void }}
 */
export const useWorkflowActions = (
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, ExtensionToWorkflow>,
    nodes: WorkflowNodes[],
    edges: Edge[],
    setPendingApprovalNodeId: React.Dispatch<React.SetStateAction<string | null>>,
    setNodeErrors: React.Dispatch<React.SetStateAction<Map<string, string>>>,
    setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>
) => {
    const onSave = useCallback(() => {
        const workflowData = {
            nodes,
            edges,
        }
        vscodeAPI.postMessage({
            type: 'save_workflow',
            data: workflowData,
        })
    }, [nodes, edges, vscodeAPI])

    const onLoad = useCallback(() => {
        vscodeAPI.postMessage({
            type: 'load_workflow',
        })
    }, [vscodeAPI])

    const calculatePreviewNodeTokens = useCallback(
        (nodes: WorkflowNodes[]) => {
            for (const node of nodes) {
                if (node.type === NodeType.PREVIEW && node.data.content) {
                    vscodeAPI.postMessage({
                        type: 'calculate_tokens',
                        data: {
                            text: node.data.content,
                            nodeId: node.id,
                        },
                    })
                }
            }
        },
        [vscodeAPI]
    )

    const handleNodeApproval = (nodeId: string, approved: boolean, modifiedCommand?: string) => {
        if (approved) {
            setPendingApprovalNodeId(null)
            vscodeAPI.postMessage({
                type: 'node_approved',
                data: { nodeId, modifiedCommand },
            })
        } else {
            // Handle rejection
            setPendingApprovalNodeId(null)
            setNodeErrors(prev => new Map(prev).set(nodeId, 'Command execution rejected by user'))
            setIsExecuting(false)
        }
    }
    return { onSave, onLoad, calculatePreviewNodeTokens, handleNodeApproval }
}
