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

export type LoopEndNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.LOOP_END
    data: BaseNodeData
}

export const LoopEndNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={{
            ...getNodeStyle(
                NodeType.LOOP_END,
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
        <div className="tw-flex tw-flex-col">
            <div
                className="tw-text-center tw-py-1 tw-mb-2 tw-rounded-t-sm tw-font-bold"
                style={{
                    backgroundColor: getBorderColor(NodeType.LOOP_END, {
                        error: data.error,
                        executing: data.executing,
                        moving: data.moving,
                        selected,
                        interrupted: data.interrupted,
                        active: data.active,
                    }),
                    color: 'var(--vscode-dropdown-background)',
                    marginLeft: '-0.5rem',
                    marginRight: '-0.5rem',
                    marginTop: '-0.5rem',
                }}
            >
                LOOP END
            </div>
            <div className="tw-flex tw-items-center">
                <span>{data.title}</span>
            </div>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)
