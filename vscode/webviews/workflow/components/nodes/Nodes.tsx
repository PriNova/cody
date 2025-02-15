import type { Node as ReactFlowNode } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'
import type { WorkflowToExtension } from '../../services/WorkflowProtocol'
import type { Edge } from '../CustomOrderedEdge'
import { AccumulatorNode } from './Accumulator_Node'
import { CLINode } from './CLI_Node'
import { CodyOutputNode } from './CodyOutput_Node'
import { IfElseNode } from './IfElse_Node'
import { LLMNode } from './LLM_Node'
import { LoopEndNode } from './LoopEnd_Node'
import { LoopStartNode } from './LoopStart_Node'
import { PreviewNode } from './Preview_Node'
import { SearchContextNode } from './SearchContext_Node'
import { TextNode } from './Text_Node'
import { VariableNode } from './Variable_Node'

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
    ACCUMULATOR = 'accumulator',
    VARIABLE = 'variable',
    IF_ELSE = 'if-else',
}

// Shared node props interface
export interface BaseNodeProps {
    data: {
        title: string
        moving?: boolean
        executing?: boolean
        error?: boolean
        content?: string
        active: boolean
        needsUserApproval?: boolean
        tokenCount?: number
        iterations?: number
        interrupted?: boolean
        handlePostMessage: (message: WorkflowToExtension) => void
    }
    selected?: boolean
}

export type BaseNodeData = {
    title: string
    input?: string
    output?: string
    content: string
    active: boolean
    needsUserApproval?: boolean
    tokenCount?: number
    local_remote?: boolean
    moving?: boolean
    executing?: boolean
    error?: boolean
    interrupted?: boolean
    result?: string
    shouldAbort?: boolean
}

export type WorkflowNode = Omit<ReactFlowNode, 'data' | 'position' | 'type' | 'id' | 'selected'> & {
    id: string
    type: NodeType
    data: BaseNodeData
    position: {
        x: number
        y: number
    }
    selected?: boolean
}

export type WorkflowNodes =
    | WorkflowNode
    | CLINode
    | LLMNode
    | PreviewNode
    | TextNode
    | SearchContextNode
    | CodyOutputNode
    | LoopStartNode
    | LoopEndNode
    | AccumulatorNode
    | VariableNode
    | IfElseNode

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
            } as TextNode
        case NodeType.SEARCH_CONTEXT:
            return {
                ...node,
                id,
                data: {
                    ...node.data,
                    local_remote: false,
                },
            } as SearchContextNode
        case NodeType.IF_ELSE:
            return {
                ...node,
                id,
                data: {
                    ...node.data,
                    truePathActive: false,
                    falsePathActive: false,
                },
            } as IfElseNode
        case NodeType.LOOP_START:
            return {
                ...node,
                id,
                data: {
                    ...node.data,
                    overrideIterations: false,
                },
            } as LoopStartNode
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
    id: `${sourceNode.id}-${targetNode.id}`,
    source: sourceNode.id,
    target: targetNode.id,
    type: 'smoothstep',
    style: {
        strokeWidth: 1,
    },
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
            data: { title: 'Git Diff', content: 'git diff', active: true },
            position: { x: 0, y: 0 },
        }),
        createNode({
            type: NodeType.LLM,
            data: {
                title: 'Cody Generate Commit Message',
                content: 'Generate a commit message for the following git diff: ${1}',
                active: true,
                temperature: 0.0,
                maxTokens: 1000,
                model: undefined,
            },
            position: { x: 0, y: 100 },
        }),
        createNode({
            type: NodeType.CLI,
            data: { title: 'Git Commit', content: 'git commit -m "${1}"', active: true },
            position: { x: 0, y: 200 },
        }),
    ]

    return {
        nodes,
        edges: [createEdge(nodes[0], nodes[1]), createEdge(nodes[1], nodes[2])],
    }
})()

export const getBorderColor = (
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
    if (selected || moving) return 'var(--vscode-testing-iconPassed)'
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
export const getNodeStyle = (
    type: NodeType,
    moving?: boolean,
    selected?: boolean,
    executing?: boolean,
    error?: boolean,
    active?: boolean,
    interrupted?: boolean
) => ({
    padding: '0.5rem',
    borderRadius: '0.25rem',
    backgroundColor: error
        ? 'var(--vscode-inputValidation-errorBackground)'
        : 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: `2px solid ${getBorderColor(type, { error, executing, moving, interrupted, selected })}`,
    opacity: !active ? '0.4' : '1',
    minWidth: '5rem',
    boxShadow: '6px 6px 8px rgba(0, 0, 0, 0.6)',
})

export const nodeTypes = {
    [NodeType.CLI]: CLINode,
    [NodeType.LLM]: LLMNode,
    [NodeType.PREVIEW]: PreviewNode,
    [NodeType.INPUT]: TextNode,
    [NodeType.SEARCH_CONTEXT]: SearchContextNode,
    [NodeType.CODY_OUTPUT]: CodyOutputNode,
    [NodeType.LOOP_START]: LoopStartNode,
    [NodeType.LOOP_END]: LoopEndNode,
    [NodeType.ACCUMULATOR]: AccumulatorNode,
    [NodeType.IF_ELSE]: IfElseNode,
    [NodeType.VARIABLE]: VariableNode,
}
