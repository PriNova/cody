import { memoize } from 'lodash'
import { useMemo } from 'react'
import {
    findStronglyConnectedComponents,
    orderComponentNodes,
    sortComponentsByDependencies,
    tarjanSort,
} from '../../../../src/workflow/node-sorting'
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
    selectedNode: WorkflowNodes | null,
    movingNodeId: string | null,
    executingNodeId: string | null,
    nodeErrors: Map<string, string>,
    nodeResults: Map<string, string>,
    interruptedNodeIds: Set<string>,
    edges: Edge[] // Add edges parameter
) => {
    return useMemo(() => {
        // Calculate all inactive nodes first
        const allInactiveNodes = new Set<string>()
        for (const node of nodes) {
            if (node.data.active === false) {
                const dependentInactiveNodes = getInactiveNodes(edges, node.id)
                for (const id of dependentInactiveNodes) {
                    allInactiveNodes.add(id)
                }
            }
        }

        return nodes.map(node => ({
            ...node,
            selected: node.id === selectedNode?.id,
            data: {
                ...node.data,
                moving: node.id === movingNodeId,
                executing: node.id === executingNodeId,
                interrupted: interruptedNodeIds.has(node.id),
                error: nodeErrors.has(node.id),
                result: nodeResults.get(node.id),
                active: !allInactiveNodes.has(node.id) && node.data.active !== false,
                tokenCount:
                    node.type === NodeType.PREVIEW
                        ? Number.parseInt(nodeResults.get(`${node.id}_tokens`) || '0', 10)
                        : undefined,
            },
        }))
    }, [
        nodes,
        selectedNode,
        movingNodeId,
        executingNodeId,
        nodeErrors,
        nodeResults,
        interruptedNodeIds,
        edges,
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
export const memoizedTopologicalSort = memoize(
    (nodes: WorkflowNodes[], edges: Edge[]) => {
        const components = findStronglyConnectedComponents(nodes, edges)
        const compositionNodes = nodes.filter(node => node.type === NodeType.LOOP_START)

        if (compositionNodes.length === 0) {
            const flatComponents = components.flat()
            const componentIds = new Set(flatComponents.map(n => n.id))

            const filteredEdges = edges.filter(
                edge => componentIds.has(edge.source) && componentIds.has(edge.target)
            )

            return tarjanSort(flatComponents, filteredEdges)
        }

        // Currently handling Loop compositions
        if (compositionNodes.some(n => n.type === NodeType.LOOP_START)) {
            return processLoopWithCycles(nodes, edges, components)
        }

        return nodes
    },
    // Keep existing memoization key generator
    (nodes: WorkflowNodes[], edges: Edge[]) => {
        const nodeKey = nodes
            .map(n => `${n.id}-${n.data.title}`)
            .sort()
            .join('|')
        const edgeKey = edges
            .map(e => `${e.source}-${e.target}`)
            .sort()
            .join('|')
        return `${nodeKey}:${edgeKey}`
    }
)

const CONTROL_FLOW_NODES = new Set([NodeType.LOOP_START, NodeType.LOOP_END])

function processLoopWithCycles(
    nodes: WorkflowNodes[],
    edges: Edge[],
    components: WorkflowNodes[][]
): WorkflowNodes[] {
    const processedNodes: WorkflowNodes[] = []
    const loopStartNodes = nodes.filter(n => n.type === NodeType.LOOP_START)

    for (const loopStart of loopStartNodes) {
        const loopEnd = nodes.find(n => n.type === NodeType.LOOP_END)
        const entryNodeId = edges.find(e => e.source === loopStart.id)?.target

        const processedComponents = components
            .filter(comp => comp.every(n => !CONTROL_FLOW_NODES.has(n.type)))
            .map(component => {
                if (component.length === 1) return component

                const componentEntryNode =
                    component.find(n => n.id === entryNodeId) ||
                    component.find(n =>
                        edges.some(e => e.source === n.id && component.some(cn => cn.id === e.target))
                    ) ||
                    component[0] // Guaranteed fallback

                return orderComponentNodes(component, componentEntryNode, edges)
            })

        const sortedComponents = sortComponentsByDependencies(processedComponents, edges)
        const flattenedNodes = sortedComponents.flat()

        const iterations = 1

        for (let i = 0; i < iterations; i++) {
            processedNodes.push({ ...loopStart })
            for (const node of flattenedNodes) {
                processedNodes.push({ ...node })
            }
            if (loopEnd) {
                processedNodes.push({ ...loopEnd })
            }
        }
    }

    return processedNodes
}
