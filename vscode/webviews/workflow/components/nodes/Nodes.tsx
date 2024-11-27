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
}

// Shared node props interface
interface BaseNodeProps {
    data: {
        title: string
        moving?: boolean
        executing?: boolean
        error?: boolean
        content?: string
    }
    selected?: boolean
}

export interface WorkflowNode {
    id: string
    type: NodeType
    data: {
        title: string
        command?: string
        prompt?: string
        input?: string
        output?: string
        content?: string
    }
    position: {
        x: number
        y: number
    }
}

/**
 * Creates a new workflow node with the specified type, label, and position.
 *
 * @param {NodeType} type - The type of the node.
 * @param {string} title - The label of the node.
 * @param {{ x: number; y: number }} position - The position of the node.
 * @returns {WorkflowNode} - The new workflow node.
 */
export const createNode = ({
    type,
    title,
    position,
    command = '', // provide defaults
    prompt = '',
    content = '',
}: {
    type: NodeType
    title: string
    position: { x: number; y: number }
    command?: string
    prompt?: string
    content?: string
}): WorkflowNode => ({
    id: uuidv4(),
    type,
    data: {
        title,
        command: type === NodeType.CLI ? command : undefined,
        prompt: type === NodeType.LLM ? prompt : undefined,
        content: type === NodeType.PREVIEW || type === NodeType.INPUT ? content : undefined,
    },
    position,
})

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
            title: 'Git Diff',
            position: { x: 0, y: 0 },
            command: 'git diff',
        }),
        createNode({
            type: NodeType.LLM,
            title: 'Cody Generate Commit Message',
            position: { x: 0, y: 100 },
            prompt: 'Generate a commit message for the following git diff: ${1}',
        }),
        createNode({
            type: NodeType.CLI,
            title: 'Git Commit',
            position: { x: 0, y: 200 },
            command: 'git commit -m "${1}"',
        }),
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
    }: {
        error?: boolean
        executing?: boolean
        moving?: boolean
        selected?: boolean
        interrupted?: boolean
    }
) => {
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
    error?: boolean
) => ({
    padding: '0.5rem',
    borderRadius: '0.25rem',
    backgroundColor: error
        ? 'var(--vscode-inputValidation-errorBackground)'
        : 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: `2px solid ${getBorderColor(type, { error, executing, moving, selected })}`,
})

export const PreviewNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div style={getNodeStyle(NodeType.PREVIEW, data.moving, selected, data.executing, data.error)}>
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
                readOnly
                placeholder="Preview content will appear here..."
            />
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

export const InputNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div style={getNodeStyle(NodeType.INPUT, data.moving, selected, data.executing, data.error)}>
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
    <div style={getNodeStyle(NodeType.CLI, data.moving, selected, data.executing, data.error)}>
        <Handle type="target" position={Position.Top} />
        <div className="tw-flex tw-items-center">
            <span>{data.title}</span>
        </div>
        <Handle type="source" position={Position.Bottom} />
    </div>
)

export const CodyLLMNode: React.FC<BaseNodeProps> = ({ data, selected }) => (
    <div style={getNodeStyle(NodeType.LLM, data.moving, selected, data.executing, data.error)}>
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
    [NodeType.SEARCH_CONTEXT]: InputNode,
}
