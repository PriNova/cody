import { useOnSelectionChange } from '@xyflow/react'
import { useCallback } from 'react'
import type { WorkflowNodes } from '../nodes/Nodes'

/**
 * A hook that provides functionality for handling node selection and click interactions in a workflow UI.
 *
 * @param setSelectedNode - A function to set the currently selected workflow node.
 * @returns An object containing event handler functions for node clicks, background clicks, and background key presses.
 */
export const useInteractionHandling = (
    setSelectedNode: React.Dispatch<React.SetStateAction<WorkflowNodes | null>>
) => {
    // Handle node selection changes from ReactFlow
    useOnSelectionChange({
        onChange: ({ nodes }) => {
            if (nodes.length === 0) {
                setSelectedNode(null)
            }
        },
    })

    // Handle direct node clicks
    const onNodeClick = useCallback(
        (event: React.MouseEvent, node: WorkflowNodes) => {
            event.stopPropagation()
            setSelectedNode(node)
        },
        [setSelectedNode]
    )

    const handleBackgroundClick = useCallback(
        (event: React.MouseEvent | React.KeyboardEvent) => {
            if (event.type === 'click' || (event as React.KeyboardEvent).key === 'Enter') {
                setSelectedNode(null)
            }
        },
        [setSelectedNode]
    )

    const handleBackgroundKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === 'Enter') {
                setSelectedNode(null)
            }
        },
        [setSelectedNode]
    )

    return { onNodeClick, handleBackgroundClick, handleBackgroundKeyDown }
}
