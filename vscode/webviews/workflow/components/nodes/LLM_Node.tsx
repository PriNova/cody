import type { Model } from '@sourcegraph/cody-shared'
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

export type LLMNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.LLM
    data: BaseNodeData & {
        temperature: number
        maxTokens?: number
        model?: Model
    }
}

export const LLMNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.LLM,
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
                    backgroundColor: getBorderColor(NodeType.LLM, {
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
                CODY
            </div>
            <div className="tw-flex tw-items-center">
                <span>{data.title}</span>
            </div>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)
