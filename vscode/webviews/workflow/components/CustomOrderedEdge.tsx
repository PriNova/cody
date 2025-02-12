import { BaseEdge, type Edge as ReactFlowEdge, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type React from 'react'
import { memo } from 'react'

export type Edge = ReactFlowEdge<any>

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
    //  sourcePosition,
    //  targetPosition,
    style,
    markerEnd,
    source,
    target,
    data,
}) => {
    const [edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        // sourcePosition,
        targetX,
        targetY,
        // targetPosition,
    })

    const orderNumber = data?.orderNumber

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
