import { Handle, Position } from '@xyflow/react'
import type React from 'react'
import {
    type BaseNodeData,
    type BaseNodeProps,
    NodeType,
    type WorkflowNode,
    getBorderColor,
    getNodeStyle,
} from './Nodes'

export type LoopStartNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.LOOP_START
    data: BaseNodeData & {
        iterations: number
        loopVariable: string
    }
}

export const LoopStartNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={{
            ...getNodeStyle(
                NodeType.LOOP_START,
                data.moving,
                selected,
                data.executing,
                data.error,
                data.active,
                data.interrupted
            ),
            borderStyle: 'double',
        }}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-flex-col tw-gap-2">
            <div
                className="tw-text-center tw-py-1 tw-mb-2 tw-rounded-t-sm tw-font-bold"
                style={{
                    background: `linear-gradient(to top, #1e1e1e, ${getBorderColor(NodeType.LOOP_START, {
                        error: data.error,
                        executing: data.executing,
                        moving: data.moving,
                        selected,
                        interrupted: data.interrupted,
                        active: data.active,
                    })}`,
                    color: ' #1e1e1e',
                    marginLeft: '-0.5rem',
                    marginRight: '-0.5rem',
                    marginTop: '-0.5rem',
                }}
            >
                LOOP START
            </div>
            <div className="tw-flex tw-flex-col tw-justify-center">
                <span>{data.title}</span>
                <span className="tw-text-sm tw-opacity-70">Iterations: {data.iterations || 1}</span>
            </div>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)
