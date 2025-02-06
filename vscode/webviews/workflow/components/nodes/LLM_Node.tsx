import type { Model } from '@sourcegraph/cody-shared'
import { Handle, Position } from '@xyflow/react'
import type React from 'react'
import { CodyLogoBW } from '../../../icons/CodyLogo'
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
                className="tw-flex tw-items-center tw-justify-center tw-py-1 tw-mb-2 tw-rounded-t-sm tw-font-bold"
                style={{
                    background: `linear-gradient(to top, #1e1e1e, ${getBorderColor(NodeType.LLM, {
                        error: data.error,
                        executing: data.executing,
                        moving: data.moving,
                        selected,
                        interrupted: data.interrupted,
                        active: data.active,
                    })}`,
                    color: 'var(--vscode-dropdown-foreground)',
                    marginLeft: '-0.5rem',
                    marginRight: '-0.5rem',
                    marginTop: '-0.5rem',
                    paddingLeft: '0.2rem',
                    paddingRight: '0.2rem',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                }}
            >
                <CodyLogoBW size={14} className="tw-mr-2 tw-ml-1" />
                <div
                    className="tw-text-center tw-flex-grow"
                    style={{
                        transform: 'translateX(-6%)', // Nudge title slightly to the left for visual centering
                    }}
                >
                    CODY AI
                </div>
            </div>
            <div className="tw-flex tw-items-center tw-justify-center">
                <span>{data.title}</span>
            </div>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)
