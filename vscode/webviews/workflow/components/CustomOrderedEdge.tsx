import { BaseEdge, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type React from 'react'
import { memo, useMemo } from 'react'

interface IndexedOrder {
    bySourceTarget: Map<string, number>
    byTarget: Map<string, Edge[]>
}

export interface Edge {
    id: string
    source: string
    target: string
    style?: {
        strokeWidth: 1
    }
}

export type OrderedEdgeProps = EdgeProps & {
    data?: {
        orderNumber: number
    }
    edges: Edge[] // Added edges prop
}

export const CustomOrderedEdgeComponent: React.FC<OrderedEdgeProps> = ({
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

    const [edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        // sourcePosition,
        targetX,
        targetY,
        // targetPosition,
    })

    const orderNumber = useMemo(
        () => edgeIndex.bySourceTarget.get(`${source}-${target}`),
        [edgeIndex, source, target]
    )

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
            <circle r="7" fill="rgb(255, 136, 0)">
                <animateMotion dur="3s" repeatCount="indefinite" path={edgePath} calcMode="linear" />
            </circle>

            {typeof orderNumber === 'number' && (
                <text
                    x={0} // Initial x position, might need adjustment
                    y={0} // Initial y position, might need adjustment
                    style={{
                        fontSize: 10,
                        fontWeight: 'bold',
                        dominantBaseline: 'central', // Vertically center text
                        textAnchor: 'middle', // Horizontally center text
                        pointerEvents: 'none', // To not interfere with node interactions
                        fill: 'rgb(0, 0, 0)',
                    }}
                >
                    <animateMotion dur="3s" repeatCount="indefinite" path={edgePath} calcMode="linear" />
                    {orderNumber}
                </text>
            )}
        </>
    )
}

export const CustomOrderedEdge = memo(CustomOrderedEdgeComponent)

export const edgeTypes: { [key: string]: React.FC<OrderedEdgeProps> } = {
    'ordered-edge': CustomOrderedEdgeComponent,
}
