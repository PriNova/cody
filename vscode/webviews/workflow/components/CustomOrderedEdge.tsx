import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type React from 'react'
import { useMemo } from 'react'

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
    edges, // Added edges parameter
}) => {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    })

    // Calculate order number based on target's parent edges
    const orderNumber = useMemo(() => {
        if (!edges) return undefined
        const parentEdges = edges.filter(e => e.target === target)
        return parentEdges.findIndex(e => e.source === source) + 1
    }, [source, target, edges])

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
