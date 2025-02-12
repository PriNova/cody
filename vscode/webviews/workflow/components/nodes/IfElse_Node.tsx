import { Handle, Position } from '@xyflow/react'
import {
    type BaseNodeData,
    type BaseNodeProps,
    NodeType,
    type WorkflowNode,
    getBorderColor,
    getNodeStyle,
} from './Nodes'

export type IfElseNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.IF_ELSE
    data: BaseNodeData & {
        truePathActive: boolean
        falsePathActive: boolean
    }
}

export const IfElseNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.IF_ELSE,
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
            <div
                className="tw-text-center tw-py-1 tw-mb-2 tw-rounded-t-sm tw-font-bold"
                style={{
                    background: `linear-gradient(to top, #1e1e1e, ${getBorderColor(NodeType.IF_ELSE, {
                        error: data.error,
                        executing: data.executing,
                        moving: data.moving,
                        selected,
                        interrupted: data.interrupted,
                        active: data.active,
                    })})`,
                    color: 'var(--vscode-dropdown-foreground)',
                    marginLeft: '-0.5rem',
                    marginRight: '-0.5rem',
                    marginTop: '-0.5rem',
                }}
            >
                IF...ELSE
            </div>
            <div className="tw-flex tw-items-center tw-justify-center tw-p-2 tw-border tw-border-[var(--vscode-input-border)] tw-rounded">
                <span>{data.condition || 'Condition'}</span>
            </div>
            <div className="tw-flex tw-justify-between tw-mt-2">
                <div className="tw-text-sm tw-opacity-75">True</div>
                <div className="tw-text-sm tw-opacity-75">False</div>
            </div>
        </div>
        <Handle type="source" position={Position.Bottom} id="true" style={{ left: '25%' }} />
        <Handle type="source" position={Position.Bottom} id="false" style={{ left: '75%' }} />
    </div>
)
