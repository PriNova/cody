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

export type CLINode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.CLI
    data: BaseNodeData
}

export const CLINode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.CLI,
            data.moving,
            selected,
            data.executing,
            data.error,
            data.active,
            data.interrupted
        )}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-flex-col">
            <div
                className="tw-text-center tw-py-1 tw-mb-2 tw-rounded-t-sm tw-font-bold"
                style={{
                    backgroundColor: getBorderColor(NodeType.CLI, {
                        error: data.error,
                        executing: data.executing,
                        moving: data.moving,
                        selected,
                        interrupted: data.interrupted,
                        active: data.active,
                    }),
                    color: 'var(--vscode-input-background)',
                    marginLeft: '-0.5rem',
                    marginRight: '-0.5rem',
                    marginTop: '-0.5rem',
                }}
            >
                CLI
            </div>
            <div className="tw-flex tw-items-center">
                <span>{data.title}</span>
            </div>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)
