import { Handle, Position } from '@xyflow/react'
import type React from 'react'
import { Textarea } from '../../../components/shadcn/ui/textarea'
import {
    type BaseNodeData,
    type BaseNodeProps,
    NodeType,
    type WorkflowNode,
    getBorderColor,
    getNodeStyle,
} from './Nodes'

export type PreviewNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.PREVIEW
    data: BaseNodeData
}

export const PreviewNode: React.FC<BaseNodeProps & { tokenCount?: number }> = ({ data, selected }) => {
    return (
        <div
            style={getNodeStyle(
                NodeType.PREVIEW,
                data.moving,
                selected,
                data.executing,
                data.error,
                data.active,
                data.interrupted
            )}
        >
            <Handle type="target" position={Position.Top} />
            <div className="tw-flex tw-flex-col tw-gap-2">
                <div className="tw-flex tw-flex-col">
                    <div
                        className="tw-text-center tw-py-1 tw-mb-2 tw-rounded-t-sm tw-font-bold"
                        style={{
                            background: `linear-gradient(to top, #1e1e1e, ${getBorderColor(
                                NodeType.PREVIEW,
                                {
                                    error: data.error,
                                    executing: data.executing,
                                    moving: data.moving,
                                    selected,
                                    interrupted: data.interrupted,
                                    active: data.active,
                                }
                            )})`,
                            color: 'var(--vscode-dropdown-foreground)',
                            marginLeft: '-0.5rem',
                            marginRight: '-0.5rem',
                            marginTop: '-0.5rem',
                        }}
                    >
                        PREVIEW
                    </div>
                    <div className="tw-flex tw-justify-between tw-items-center">
                        <span>{data.title}</span>
                        <span className="tw-text-sm tw-opacity-70">Tokens: {data.tokenCount || 0}</span>
                    </div>
                </div>
                <Textarea
                    className="tw-w-full tw-h-24 tw-p-2 tw-rounded nodrag tw-resize tw-border-2 tw-border-solid tw-border-[var(--xy-node-border-default)]"
                    style={{
                        color: 'var(--vscode-editor-foreground)',
                        backgroundColor: 'var(--vscode-input-background)',
                        outline: 'none',
                    }}
                    value={data.content || ''}
                    readOnly
                    placeholder="Preview content will appear here..."
                />
            </div>
            <Handle type="source" position={Position.Bottom} />
        </div>
    )
}
