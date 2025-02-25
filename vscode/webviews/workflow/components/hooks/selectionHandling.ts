import { useOnSelectionChange } from '@xyflow/react'
import { useCallback } from 'react'
import type { WorkflowNodes } from '../nodes/Nodes'

/**
 * A hook that provides functionality for handling node selection and click interactions in a workflow UI.
 *
 * @param setSelectedNodes - A function to set the currently selected workflow nodes.
 * @param setActiveNode - A function to set the single active node for the sidebar.
 * @returns An object containing event handler functions for node interactions.
 */
export const useInteractionHandling = (
    setSelectedNodes: React.Dispatch<React.SetStateAction<WorkflowNodes[]>>,
    setActiveNode: React.Dispatch<React.SetStateAction<WorkflowNodes | null>>
) => {
    // Handle node selection changes from ReactFlow
    useOnSelectionChange({
        onChange: ({ nodes }) => {
            const selectedWorkflowNodes = nodes as WorkflowNodes[]

            // Update selected nodes
            setSelectedNodes(selectedWorkflowNodes)

            // Update active node if needed
            if (selectedWorkflowNodes.length > 0) {
                setActiveNode(current => {
                    // If no current active node, use first selected node
                    if (!current) return selectedWorkflowNodes[0]

                    // If current active node is still in selection, keep it
                    if (selectedWorkflowNodes.some(n => n.id === current.id)) {
                        return current
                    }

                    // Otherwise, use first selected node
                    return selectedWorkflowNodes[0]
                })
            } else if (selectedWorkflowNodes.length === 0) {
                setActiveNode(null)
            }
        },
    })

    // Node click handler with better Ctrl/Cmd handling
    const onNodeClick = useCallback(
        (event: React.MouseEvent, node: WorkflowNodes) => {
            event.stopPropagation()

            const isModifierPressed = event.ctrlKey || event.metaKey

            if (isModifierPressed) {
                // Toggle node selection when using modifier key
                setSelectedNodes(prevNodes => {
                    const isNodeSelected = prevNodes.some(n => n.id === node.id)

                    if (isNodeSelected) {
                        // Remove node from selection
                        const newSelection = prevNodes.filter(n => n.id !== node.id)

                        // Update active node if needed
                        if (newSelection.length > 0) {
                            // If we removed the active node, make another node active
                            setActiveNode(current => {
                                return current?.id === node.id ? newSelection[0] : current
                            })
                        } else {
                            setActiveNode(null)
                        }

                        return newSelection
                    }
                    // Add node to selection
                    return [...prevNodes, node]
                })
            } else {
                // Single node selection (no modifier)
                setSelectedNodes([node])
                setActiveNode(node)
            }
        },
        [setSelectedNodes, setActiveNode]
    )

    // Better background click handler
    const handleBackgroundClick = useCallback(
        (event: React.MouseEvent | React.KeyboardEvent) => {
            // Only handle direct clicks, not drag release events
            if (
                (event.type === 'click' && !(event as React.MouseEvent).shiftKey) ||
                (event as React.KeyboardEvent).key === 'Enter'
            ) {
                setSelectedNodes([])
                setActiveNode(null)
            }
        },
        [setSelectedNodes, setActiveNode]
    )

    const handleBackgroundKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === 'Enter') {
                setSelectedNodes([])
                setActiveNode(null)
            }
        },
        [setSelectedNodes, setActiveNode]
    )

    return { onNodeClick, handleBackgroundClick, handleBackgroundKeyDown }
}
