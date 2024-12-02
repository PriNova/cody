import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type React from 'react'
import { useMemo } from 'react'

interface IndexedOrder {
    bySourceTarget: Map<string, number>
    byTarget: Map<string, Edge[]>
}

export interface Edge {
    id: string
    source: string
    target: string
}

export type OrderedEdgeProps = EdgeProps & {
    data?: {
        orderNumber: number
    }
    edges: Edge[] // Added edges prop
}

export const CustomOrderedEdge: React.FC<OrderedEdgeProps> = ({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    source,
    target,
    edges,
}) => {
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

    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    })

    const orderNumber = useMemo(
        () => edgeIndex.bySourceTarget.get(`${source}-${target}`),
        [edgeIndex, source, target]
    )

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
            {typeof orderNumber === 'number' && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                            padding: '4px 8px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--vscode-badge-background)',
                            color: 'var(--vscode-badge-foreground)',
                            fontSize: 12,
                            fontWeight: 'bold',
                            pointerEvents: 'all',
                        }}
                    >
                        {orderNumber}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    )
}

export const edgeTypes: { [key: string]: React.FC<OrderedEdgeProps> } = {
    'ordered-edge': CustomOrderedEdge,
}
