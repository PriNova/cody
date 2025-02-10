import { Handle, Position } from '@xyflow/react'
import {
    type BaseNodeData,
    type BaseNodeProps,
    NodeType,
    type WorkflowNode,
    getBorderColor,
    getNodeStyle,
} from './Nodes'

export type AccumulatorNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.ACCUMULATOR
    data: BaseNodeData & {
        variableName: string
        initialValue?: string
        content?: string
    }
}

export const AccumulatorNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.INPUT,
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
                    background: `linear-gradient(to top, #1e1e1e, ${getBorderColor(NodeType.INPUT, {
                        error: data.error,
                        executing: data.executing,
                        moving: data.moving,
                        selected,
                        interrupted: data.interrupted,
                        active: data.active,
                    })})`,
                    color: '#1e1e1e',
                    marginLeft: '-0.5rem',
                    marginRight: '-0.5rem',
                    marginTop: '-0.5rem',
                }}
            >
                ACCUMULATOR
            </div>
            <div className="tw-flex tw-items-center tw-justify-center">
                <span>{data.title}</span>
            </div>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)
