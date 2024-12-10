import type { GenericVSCodeWrapper } from '@sourcegraph/cody-shared'
import { useCallback, useState } from 'react'
import type { WorkflowFromExtension, WorkflowToExtension } from '../../services/WorkflowProtocol'
import type { Edge } from '../CustomOrderedEdge'
import { NodeType, type WorkflowNodes } from '../nodes/Nodes'

/**
 * A React hook that manages the execution state of a workflow.
 *
 * @param vscodeAPI - The GenericVSCodeWrapper instance for communication with the extension.
 * @param nodes - The workflow nodes.
 * @param edges - The workflow edges.
 * @param setNodes - A function to update the workflow nodes.
 * @param setEdges - A function to update the workflow edges.
 * @returns An object containing the execution state and actions to control the workflow execution.
 */
export const useWorkflowExecution = (
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, WorkflowFromExtension>,
    nodes: WorkflowNodes[],
    edges: Edge[],
    setNodes: (nodes: WorkflowNodes[]) => void,
    setEdges: (edges: Edge[]) => void
) => {
    // Move all state declarations to the top
    const [isExecuting, setIsExecuting] = useState(false)
    const [abortController, setAbortController] = useState<AbortController | null>(null)
    const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map())
    const [executingNodeId, setExecutingNodeId] = useState<string | null>(null)
    const [interruptedNodeIds, setInterruptedNodeIds] = useState<Set<string>>(new Set())
    const [nodeResults, setNodeResults] = useState<Map<string, string>>(new Map())

    const resetExecutionState = useCallback(() => {
        setNodes([])
        setEdges([])
        setIsExecuting(false)
        setNodeErrors(new Map())
        setExecutingNodeId(null)
        setInterruptedNodeIds(new Set())
        setAbortController(null)
        setNodeResults(new Map())
    }, [setEdges, setNodes])

    const onExecute = useCallback(() => {
        const invalidNodes = nodes.filter(node => {
            if (node.type === NodeType.LLM) {
                return !node.data.content || node.data.content.trim() === ''
            }
            return false
        })

        if (invalidNodes.length > 0) {
            const newErrors = new Map<string, string>()
            for (const node of invalidNodes) {
                const errorMessage =
                    node.type === NodeType.CLI ? 'Command field is required' : 'Prompt field is required'
                newErrors.set(node.id, errorMessage)
            }
            setNodeErrors(newErrors)
            return
        }

        setNodeErrors(new Map())
        const controller = new AbortController()
        setAbortController(controller)
        setIsExecuting(true)

        vscodeAPI.postMessage({
            type: 'execute_workflow',
            data: { nodes, edges },
        })
    }, [nodes, edges, vscodeAPI])

    const onAbort = useCallback(() => {
        if (abortController) {
            abortController.abort()
            setAbortController(null)
            setIsExecuting(false)
            vscodeAPI.postMessage({
                type: 'abort_workflow',
            })
        }
    }, [abortController, vscodeAPI])

    return {
        // State
        isExecuting,
        executingNodeId,
        nodeErrors,
        nodeResults,
        interruptedNodeIds,
        // Actions
        onExecute,
        onAbort,
        resetExecutionState,
        // State setters
        setExecutingNodeId,
        setIsExecuting,
        setInterruptedNodeIds,
        setNodeResults,
        setNodeErrors,
    }
}
