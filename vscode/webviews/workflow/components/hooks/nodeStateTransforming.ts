import { useMemo } from 'react'
import { processGraphComposition } from '../../../../src/workflow/node-sorting'
import type { Edge } from '../CustomOrderedEdge'
import { NodeType, type WorkflowNodes } from '../nodes/Nodes'

/**
 * A React hook that transforms the state of workflow nodes based on various conditions and context.
 *
 * This hook takes in a set of workflow nodes, along with various state variables such as the selected node, moving node,
 * executing node, node errors, node results, and interrupted node IDs. It also takes in the set of edges between the workflow nodes.
 * The hook then maps over the input nodes and returns a new array of nodes with their state transformed based on the provided context.
 * This includes setting the `selected`, `moving`, `executing`, `interrupted`, `error`, `result`, `active`, and `tokenCount` properties on the node data.
 * The transformation logic ensures that nodes are marked as inactive if they depend on other inactive nodes, and that the `tokenCount` property is set correctly for preview nodes.
 *
 * @param nodes - The workflow nodes to transform.
 * @param selectedNode - The currently selected workflow node.
 * @param movingNodeId - The ID of the workflow node that is currently being moved.
 * @param executingNodeId - The ID of the workflow node that is currently being executed.
 * @param nodeErrors - A map of node IDs to error messages.
 * @param nodeResults - A map of node IDs to result strings.
 * @param interruptedNodeIds - A set of workflow node IDs that have been interrupted.
 * @param edges - The edges between the workflow nodes.
 * @returns A new array of workflow nodes with their state transformed based on the provided context.
 */
export const useNodeStateTransformation = (
    nodes: WorkflowNodes[],
    selectedNodes: WorkflowNodes[],
    movingNodeId: string | null,
    executingNodeId: string | null,
    nodeErrors: Map<string, string>,
    nodeResults: Map<string, string>,
    interruptedNodeId: string | null,
    edges: Edge[]
): WorkflowNodes[] => {
    // Create a Set for O(1) lookups instead of O(n)
    const selectedNodeIds = useMemo(() => new Set(selectedNodes.map(node => node.id)), [selectedNodes])

    // Memoize inactive nodes calculation
    const allInactiveNodes = useMemo(() => {
        const inactiveSet = new Set<string>()

        // Only recalculate if there are inactive nodes
        const hasInactiveNodes = nodes.some(node => node.data.active === false)

        if (hasInactiveNodes) {
            for (const node of nodes) {
                if (node.data.active === false) {
                    const dependentInactiveNodes = getInactiveNodes(edges, node.id)
                    for (const id of dependentInactiveNodes) {
                        inactiveSet.add(id)
                    }
                }
            }
        }

        return inactiveSet
    }, [nodes, edges])

    // Memoize node state updates
    return useMemo(() => {
        return nodes.map(node => {
            const nodeId = node.id
            const nodeIsSelected = selectedNodeIds.has(nodeId)
            const nodeIsMoving = nodeId === movingNodeId
            const nodeIsExecuting = nodeId === executingNodeId
            const nodeIsInterrupted = nodeId === interruptedNodeId
            const nodeHasError = nodeErrors.has(nodeId)
            const nodeResult = nodeResults.get(nodeId)
            const nodeIsActive = !allInactiveNodes.has(nodeId) && node.data.active !== false

            // Only calculate token count for preview nodes
            const tokenCount =
                node.type === NodeType.PREVIEW
                    ? Number.parseInt(nodeResults.get(`${nodeId}_tokens`) || '0', 10)
                    : undefined

            return {
                ...node,
                selected: nodeIsSelected,
                data: {
                    ...node.data,
                    moving: nodeIsMoving,
                    executing: nodeIsExecuting,
                    interrupted: nodeIsInterrupted,
                    error: nodeHasError,
                    result: nodeResult,
                    active: nodeIsActive,
                    tokenCount,
                },
            }
        })
    }, [
        nodes,
        selectedNodeIds,
        movingNodeId,
        executingNodeId,
        nodeErrors,
        nodeResults,
        interruptedNodeId,
        allInactiveNodes,
    ])
}

/**
 * Calculates the set of inactive nodes that depend on the given start node, by traversing the edges in the graph.
 *
 * @param edges - The edges in the graph.
 * @param startNodeId - The ID of the start node.
 * @returns A set of node IDs that are inactive and depend on the start node.
 */
export function getInactiveNodes(edges: Edge[], startNodeId: string): Set<string> {
    const inactiveNodes = new Set<string>()
    const queue = [startNodeId]

    while (queue.length > 0) {
        const currentId = queue.shift()!
        inactiveNodes.add(currentId)

        // Find all nodes that depend on the current node
        for (const edge of edges) {
            if (edge.source === currentId && !inactiveNodes.has(edge.target)) {
                queue.push(edge.target)
            }
        }
    }

    return inactiveNodes
}

/**
 * Performs a topological sort of the given workflow nodes and edges, returning the nodes in a sorted order.
 *
 * The topological sort ensures that nodes with no dependencies are placed first, and the order of the sorted nodes
 * respects the edges between them. This is useful for ensuring that the workflow execution order is correct.
 *
 * @param nodes - The workflow nodes to sort.
 * @param edges - The edges between the workflow nodes.
 * @returns The workflow nodes in a sorted order.
 */
export const memoizedTopologicalSort = (nodes: WorkflowNodes[], edges: Edge[]) => {
    return processGraphComposition(nodes, edges, false)
}
