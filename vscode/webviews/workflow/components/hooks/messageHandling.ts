import { useCallback, useEffect } from 'react'
import type { WorkflowFromExtension } from '../../services/WorkflowProtocol'
import type { Edge } from '../CustomOrderedEdge'
import { NodeType, type WorkflowNodes } from '../nodes/Nodes'

/**
 * A React hook that handles message events from the workflow extension and updates the component state accordingly.
 *
 * This hook is responsible for processing various message types received from the workflow extension and updating the component state accordingly. It handles events such as workflow loaded, node execution status, execution started/completed, and token count updates.
 *
 * @param nodes - The current workflow nodes.
 * @param setNodes - Function to update the workflow nodes.
 * @param setEdges - Function to update the workflow edges.
 * @param setNodeErrors - Function to update the node error map.
 * @param setNodeResults - Function to update the node result map.
 * @param setInterruptedNodeIds - Function to update the set of interrupted node IDs.
 * @param setExecutingNodeId - Function to update the ID of the currently executing node.
 * @param setIsExecuting - Function to update the flag indicating if the workflow is currently executing.
 * @param onNodeUpdate - Function to update the data of a specific node.
 * @param calculatePreviewNodeTokens - Function to calculate the token count for preview nodes.
 * @param batchUpdateNodeResults - Function to batch update the node results.
 * @param setPendingApprovalNodeId - Function to update the ID of the node pending approval.
 */
export const useMessageHandler = (
    nodes: WorkflowNodes[],
    setNodes: React.Dispatch<React.SetStateAction<WorkflowNodes[]>>,
    setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
    setNodeErrors: React.Dispatch<React.SetStateAction<Map<string, string>>>,
    setNodeResults: React.Dispatch<React.SetStateAction<Map<string, string>>>,
    setInterruptedNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>,
    setExecutingNodeId: React.Dispatch<React.SetStateAction<string | null>>,
    setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>,
    onNodeUpdate: (nodeId: string, data: Partial<WorkflowNodes['data']>) => void,
    calculatePreviewNodeTokens: (nodes: WorkflowNodes[]) => void,
    setPendingApprovalNodeId: React.Dispatch<React.SetStateAction<string | null>>
) => {
    const batchUpdateNodeResults = useCallback(
        (updates: Map<string, string>, node?: WorkflowNodes) => {
            setNodeResults(prev => new Map([...prev, ...updates]))
        },
        [setNodeResults]
    )

    useEffect(() => {
        const messageHandler = (event: MessageEvent<WorkflowFromExtension>) => {
            switch (event.data.type) {
                case 'workflow_loaded': {
                    const { nodes, edges } = event.data.data
                    if (nodes && edges) {
                        calculatePreviewNodeTokens(nodes)
                        setNodes(nodes)
                        setEdges(edges)
                        setNodeErrors(new Map())
                    }
                    break
                }

                case 'node_execution_status': {
                    const { nodeId, status, result } = event.data.data
                    if (nodeId && status) {
                        if (event.data.data.status === 'interrupted') {
                            setInterruptedNodeIds(prev => {
                                prev.add(nodeId)
                                return new Set(prev)
                            })
                        }
                        if (status === 'pending_approval') {
                            setPendingApprovalNodeId(nodeId) // Set the pending approval state
                        } else if (status === 'running') {
                            setExecutingNodeId(nodeId)
                            setNodeErrors(prev => {
                                const updated = new Map(prev)
                                updated.delete(nodeId)
                                return updated
                            })
                        } else if (status === 'error') {
                            setExecutingNodeId(null)
                            setNodeErrors(prev => new Map(prev).set(nodeId, result ?? ''))
                        } else if (status === 'completed') {
                            setExecutingNodeId(null)
                            const node = nodes.find(n => n.id === nodeId)
                            if (node?.type === NodeType.PREVIEW) {
                                onNodeUpdate(node.id, { content: result })
                            }
                        } else {
                            setExecutingNodeId(null)
                        }

                        setNodeResults(prev => new Map(prev).set(nodeId, result ?? ''))
                    }
                    break
                }

                case 'execution_started':
                    setIsExecuting(true)
                    break

                case 'execution_completed':
                    setIsExecuting(false)
                    break

                case 'token_count': {
                    const { count, nodeId } = event.data.data
                    const updates = new Map([[`${nodeId}_tokens`, count.toString()]])
                    batchUpdateNodeResults(updates)
                    break
                }
            }
        }

        window.addEventListener('message', messageHandler)
        return () => window.removeEventListener('message', messageHandler)
    }, [
        nodes,
        onNodeUpdate,
        setEdges,
        setExecutingNodeId,
        setInterruptedNodeIds,
        setIsExecuting,
        setNodeErrors,
        setNodeResults,
        setNodes,
        calculatePreviewNodeTokens,
        setPendingApprovalNodeId,
        batchUpdateNodeResults,
    ])
}
