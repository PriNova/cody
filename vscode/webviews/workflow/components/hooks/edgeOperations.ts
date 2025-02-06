import { type EdgeChange, addEdge, applyEdgeChanges } from '@xyflow/react'
import type React from 'react'
import { useCallback, useMemo } from 'react'
import type { Edge } from '../CustomOrderedEdge'
import type { WorkflowNodes } from '../nodes/Nodes'

interface IndexedOrder {
    bySourceTarget: Map<string, number>
    byTarget: Map<string, Edge[]>
}

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
    const onEdgesDelete = useCallback(
        (deletedEdges: Edge[]) => {
            setEdges(prevEdges => {
                const updatedEdges = prevEdges.filter(
                    edge => !deletedEdges.some(deleted => deleted.id === edge.id)
                )
                return [...updatedEdges]
            })
        },
        [setEdges]
    )

    // Reimplementing the edgeIndex logic from CustomOrderedEdgeComponent
    const edgeIndex = useMemo((): IndexedOrder => {
        const bySourceTarget = new Map<string, number>()
        const byTarget = new Map<string, Edge[]>()

        if (!edges) return { bySourceTarget, byTarget }

        // Index edges by target for quick parent edge lookups
        for (const edge of edges) {
            const targetEdges = byTarget.get(edge.target) || []
            targetEdges.push(edge)
            byTarget.set(edge.target, targetEdges)
        }

        // Precompute order numbers
        for (const [targetId, targetEdges] of byTarget) {
            targetEdges.forEach((edge, index) => {
                const key = `${edge.source}-${targetId}`
                bySourceTarget.set(key, index + 1)
            })
        }

        return { bySourceTarget, byTarget }
    }, [edges])

    // Memoize the edge order map calculation
    const edgesWithOrder = useMemo(() => {
        const ordered = edges.map(edge => {
            const orderNumber = edgeIndex.bySourceTarget.get(`${edge.source}-${edge.target}`) || 0
            return {
                ...edge,
                type: 'ordered-edge',
                data: {
                    orderNumber: orderNumber,
                },
            }
        })
        return [...ordered]
    }, [edges, edgeIndex])

    const onEdgesChange = useCallback(
        (changes: EdgeChange[]) => {
            setEdges(edges => {
                const updatedEdges = applyEdgeChanges(changes, edges)
                return [...updatedEdges]
            })
        },
        [setEdges]
    )

    const onConnect = useCallback(
        (params: any) => {
            setEdges(eds => {
                const newEdge = {
                    ...params,
                    type: 'smoothstep',
                } as Edge
                const updatedEdges = addEdge(newEdge, eds)
                return [...updatedEdges]
            })
        },
        [setEdges] // ADDED creationOrderedEdges to dependencies to get the updated value in the log
    )

    return {
        onEdgesChange,
        onConnect,
        onEdgesDelete,
        orderedEdges: edgesWithOrder,
    }
}
