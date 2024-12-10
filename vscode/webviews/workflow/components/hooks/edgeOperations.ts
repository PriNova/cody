import { type EdgeChange, addEdge, applyEdgeChanges } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import type { Edge } from '../CustomOrderedEdge'
import type { WorkflowNodes } from '../nodes/Nodes'
import { memoizedTopologicalSort } from './nodeStateTransforming'

/**
 * A React hook that provides functionality for managing edges in a workflow application.
 *
 * The hook takes an array of `Edge` objects, a function to update the edges, and an array of `WorkflowNodes` objects.
 * It returns an object with three properties:
 * - `onEdgesChange`: a callback function to apply changes to the edges
 * - `onConnect`: a callback function to add a new edge
 * - `getEdgesWithOrder`: an array of `Edge` objects with the calculated order information
 *
 * The hook memoizes the results of the topological sort of the nodes and the calculation of the edge order, to optimize performance.
 */
export const useEdgeOperations = (
    edges: Edge[],
    setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
    nodes: WorkflowNodes[]
) => {
    // Memoize the topological sort results
    const sortedNodes = useMemo(() => memoizedTopologicalSort(nodes, edges), [nodes, edges])

    // Memoize the edge order map calculation
    const edgeOrder = useMemo(() => {
        const orderMap = new Map<string, number>()
        const edgesByTarget = new Map<string, Edge[]>()

        // Group edges by target
        for (const edge of edges) {
            const targetEdges = edgesByTarget.get(edge.target) || []
            targetEdges.push(edge)
            edgesByTarget.set(edge.target, targetEdges)
        }

        // Calculate orders using our memoized sorted nodes
        for (const targetEdges of edgesByTarget.values()) {
            const sortedEdges = targetEdges.sort((a, b) => {
                const aIndex = sortedNodes.findIndex(node => node.id === a.source)
                const bIndex = sortedNodes.findIndex(node => node.id === b.source)
                return aIndex - bIndex
            })

            sortedEdges.forEach((edge, index) => {
                orderMap.set(edge.id, index + 1)
            })
        }

        return orderMap
    }, [edges, sortedNodes])

    // Memoize the final edges with order data
    const edgesWithOrder = useMemo(
        () =>
            edges.map(edge => ({
                ...edge,
                type: 'ordered-edge',
                data: {
                    orderNumber: edgeOrder.get(edge.id) || 0,
                },
            })),
        [edges, edgeOrder]
    )

    const onEdgesChange = useCallback(
        (changes: EdgeChange[]) => setEdges(eds => applyEdgeChanges(changes, eds) as typeof edges),
        [setEdges]
    )

    const onConnect = useCallback((params: any) => setEdges(eds => addEdge(params, eds)), [setEdges])

    return {
        onEdgesChange,
        onConnect,
        getEdgesWithOrder: edgesWithOrder,
    }
}
