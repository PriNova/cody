import { Handle, Position } from '@xyflow/react'
import type React from 'react'
import {
    type BaseNodeData,
    type BaseNodeProps,
    NodeType,
    type WorkflowNode,
    getNodeStyle,
} from './Nodes'

export type CodyOutputNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.CODY_OUTPUT
    data: BaseNodeData
}

export const CodyOutputNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={{
            ...getNodeStyle(
                NodeType.CODY_OUTPUT,
                data.moving,
                selected,
                data.executing,
                data.error,
                data.active,
                data.interrupted
            ),
            borderRadius: '5rem',
            backgroundColor: 'var(--vscode-focusBorder)',
        }}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-items-center">
            <span>{data.title}</span>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)
