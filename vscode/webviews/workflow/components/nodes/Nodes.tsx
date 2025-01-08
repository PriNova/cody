import { Handle, Position } from '@xyflow/react'
import type React from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Textarea } from '../../../components/shadcn/ui/textarea'
import type { Edge } from '../CustomOrderedEdge'

// Core type definitions
export enum NodeType {
    CLI = 'cli',
    LLM = 'llm',
    PREVIEW = 'preview',
    INPUT = 'text-format',
    SEARCH_CONTEXT = 'search-context',
    CODY_OUTPUT = 'cody-output',
    LOOP_START = 'loop-start',
    LOOP_END = 'loop-end',
}

// Shared node props interface
interface BaseNodeProps {
    data: {
        title: string
        moving?: boolean
        executing?: boolean
        error?: boolean
        content?: string
        active?: boolean
        needsUserApproval?: boolean
        tokenCount?: number
        iterations?: number
    }
    selected?: boolean
}

type BaseNodeData = {
    title: string
    input?: string
    output?: string
    content: string
    active?: boolean
    needsUserApproval?: boolean
    tokenCount?: number
}

export type WorkflowNode = {
    id: string
    type: NodeType
    data: BaseNodeData
    position: {
        x: number
        y: number
    }
}

export type CLINode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.CLI
    data: BaseNodeData
}

export type LLMNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.LLM
    data: BaseNodeData & {
        temperature: number
        fast?: boolean
        maxTokens?: number
    }
}

export type PreviewNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.PREVIEW
    data: BaseNodeData
}

export type InputNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.INPUT
    data: BaseNodeData
}

export type SearchContextNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.SEARCH_CONTEXT
    data: BaseNodeData
}

export type CodyOutputNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.CODY_OUTPUT
    data: BaseNodeData
}

export type LoopStartNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.LOOP_START
    data: BaseNodeData & {
        iterations: number
        loopVariable: string
    }
}

export type LoopEndNode = Omit<WorkflowNode, 'data'> & {
    type: NodeType.LOOP_END
    data: BaseNodeData
}

export type WorkflowNodes =
    | WorkflowNode
    | CLINode
    | LLMNode
    | PreviewNode
    | InputNode
    | SearchContextNode
    | CodyOutputNode
    | LoopStartNode
    | LoopEndNode

/**
 * Creates a new workflow node with the specified type, label, and position.
 *
 * @param {NodeType} type - The type of the node.
 * @param {string} title - The label of the node.
 * @param {{ x: number; y: number }} position - The position of the node.
 * @returns {WorkflowNode} - The new workflow node.
 */
export const createNode = (node: Omit<WorkflowNodes, 'id'>): WorkflowNodes => {
    const id = uuidv4()

    switch (node.type) {
        case NodeType.CLI:
            return {
                ...node,
                id,
                needsUserApproval: false,
            } as CLINode

        case NodeType.LLM:
            return {
                ...node,
                id,
            } as LLMNode

        case NodeType.PREVIEW:
            return {
                ...node,
                id,
            } as PreviewNode

        case NodeType.INPUT:
            return {
                ...node,
                id,
            } as InputNode

        default:
            return {
                ...node,
                id,
            }
    }
}

/* Creates a connection between two nodes.
 *
 * @param {WorkflowNode} sourceNode The node to connect from.
 * @param {Node} targetNode - The node to connect to.
 * @returns id: string,: string, target string }} - The edge.
 */
export const createEdge = (sourceNode: WorkflowNode, targetNode: WorkflowNode): Edge => ({
    id: `${sourceNode}-${targetNode.id}`,
    source: sourceNode.id,
    target: targetNode.id,
})

/**
 * Defines the default workflow in the application, including three nodes:
 * - A Git Diff CLI node at position (0, 0)
 * - A Cody Generate Commit Message LLM node at position (0, 100)
 * - A Git Commit CLI node at position (0, 200)
 *
 * The workflow also includes two edges connecting the nodes:
 * - An edge from the Git Diff node to the Cody Generate Commit Message node
 * - An edge from the Cody Generate Commit Message node to the Git Commit node
 */
export const defaultWorkflow = (() => {
    const nodes = [
        createNode({
            type: NodeType.CLI,
            data: { title: 'Git Diff', content: 'git diff' },
            position: { x: 0, y: 0 },
        }) as CLINode,
        createNode({
            type: NodeType.LLM,
            data: {
                title: 'Cody Generate Commit Message',
                content: 'Generate a commit message for the following git diff: ${1}',
                temperature: 0.0,
                fast: true,
                maxTokens: 1000,
            },
            position: { x: 0, y: 100 },
        }) as LLMNode,
        createNode({
            type: NodeType.CLI,
            data: { title: 'Git Commit', content: 'git commit -m "${1}"' },
            position: { x: 0, y: 200 },
        }) as CLINode,
    ]

    return {
        nodes,
        edges: [createEdge(nodes[0], nodes[1]), createEdge(nodes[1], nodes[2])],
    }
})()
const getBorderColor = (
    type: NodeType,
    {
        error,
        executing,
        moving,
        selected,
        interrupted,
        active,
    }: {
        error?: boolean
        executing?: boolean
        moving?: boolean
        selected?: boolean
        interrupted?: boolean
        active?: boolean
    }
) => {
    if (active === false) {
        return 'var(--vscode-disabledForeground)'
    }
    if (interrupted) return 'var(--vscode-charts-orange)'
    if (error) return 'var(--vscode-inputValidation-errorBorder)'
    if (executing) return 'var(--vscode-charts-yellow)'
    if (moving) return 'var(--vscode-focusBorder)'
    if (selected) return 'var(--vscode-testing-iconPassed)'
    // Node type specific colors
    switch (type) {
        case NodeType.PREVIEW:
            return '#aa0000'
        case NodeType.CLI:
            return 'var(--vscode-textLink-foreground)'
        case NodeType.LLM:
            return 'var(--vscode-symbolIcon-functionForeground)'
        case NodeType.INPUT:
            return 'var(--vscode-input-foreground)'
        default:
            return 'var(--vscode-foreground)'
    }
}

/**
 * Generates a style object for a node in the workflow based on its type and state.
 *
 * @param type - The type of the node.
 * @param moving - Whether the node is currently being moved.
 * @param selected - Whether the node is currently selected.
 * @param executing - Whether the node is currently executing.
 * @param error - Whether the node is in an error state.
 * @returns A style object for the node.
 */
const getNodeStyle = (
    type: NodeType,
    moving?: boolean,
    selected?: boolean,
    executing?: boolean,
    error?: boolean,
    active?: boolean
) => ({
    padding: '0.5rem',
    borderRadius: '0.25rem',
    backgroundColor: error
        ? 'var(--vscode-inputValidation-errorBackground)'
        : 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: `2px solid ${getBorderColor(type, { error, executing, moving, selected })}`,
    opacity: !active ? '0.4' : '1',
})

export const PreviewNode: React.FC<BaseNodeProps & { tokenCount?: number }> = ({ data, selected }) => {
    return (
        <div
            style={getNodeStyle(
                NodeType.PREVIEW,
                data.moving,
                selected,
                data.executing,
                data.error,
                data.active
            )}
        >
            <Handle type="target" position={Position.Top} />
            <div className="tw-flex tw-flex-col tw-gap-2">
                <div className="tw-flex tw-justify-between tw-items-center">
                    <span>{data.title}</span>
                    <span className="tw-text-sm tw-opacity-70">Tokens: {data.tokenCount || 0}</span>
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

export const InputNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.INPUT,
            data.moving,
            selected,
            data.executing,
            data.error,
            data.active
        )}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-flex-col tw-gap-2">
            <span>{data.title}</span>
            <Textarea
                className="tw-w-full tw-h-24 tw-p-2 tw-rounded nodrag tw-resize tw-border-2 tw-border-solid tw-border-[var(--xy-node-border-default)]"
                style={{
                    color: 'var(--vscode-editor-foreground)',
                    backgroundColor: 'var(--vscode-input-background)',
                    outline: 'none',
                }}
                value={data.content || ''}
                placeholder="Enter your input text here..."
            />
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

export const SearchContextNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.INPUT,
            data.moving,
            selected,
            data.executing,
            data.error,
            data.active
        )}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-flex-col tw-gap-2">
            <span>{data.title}</span>
            <Textarea
                className="tw-w-full tw-h-24 tw-p-2 tw-rounded nodrag tw-resize tw-border-2 tw-border-solid tw-border-[var(--xy-node-border-default)]"
                style={{
                    color: 'var(--vscode-editor-foreground)',
                    backgroundColor: 'var(--vscode-input-background)',
                    outline: 'none',
                }}
                value={data.content || ''}
                placeholder="Enter your input text here..."
            />
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

// Node Components with shared base props
export const CLINode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.CLI,
            data.moving,
            selected,
            data.executing,
            data.error,
            data.active
        )}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-items-center">
            <span>{data.title}</span>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

export const CodyLLMNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={getNodeStyle(
            NodeType.LLM,
            data.moving,
            selected,
            data.executing,
            data.error,
            data.active
        )}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-items-center">
            <span>{data.title}</span>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

export const CodyOutputNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={{
            ...getNodeStyle(
                NodeType.CODY_OUTPUT,
                data.moving,
                selected,
                data.executing,
                data.error,
                data.active
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

export const LoopStartNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={{
            ...getNodeStyle(
                NodeType.LOOP_START,
                data.moving,
                selected,
                data.executing,
                data.error,
                data.active
            ),
            borderStyle: 'double',
        }}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-flex-col tw-gap-2">
            <span>{data.title}</span>
            <span className="tw-text-sm tw-opacity-70">Iterations: {data.iterations || 1}</span>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

export const LoopEndNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div
        style={{
            ...getNodeStyle(
                NodeType.LOOP_END,
                data.moving,
                selected,
                data.executing,
                data.error,
                data.active
            ),
            borderStyle: 'double',
        }}
    >
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-items-center">
            <span>{data.title}</span>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

export const nodeTypes = {
    [NodeType.CLI]: CLINode,
    [NodeType.LLM]: CodyLLMNode,
    [NodeType.PREVIEW]: PreviewNode,
    [NodeType.INPUT]: InputNode,
    [NodeType.SEARCH_CONTEXT]: SearchContextNode,
    [NodeType.CODY_OUTPUT]: CodyOutputNode,
    [NodeType.LOOP_START]: LoopStartNode,
    [NodeType.LOOP_END]: LoopEndNode,
}
