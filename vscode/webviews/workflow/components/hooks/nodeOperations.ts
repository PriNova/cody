import type { GenericVSCodeWrapper } from '@sourcegraph/cody-shared'
import { type NodeChange, applyNodeChanges, useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import type { ExtensionToWorkflow, WorkflowToExtension } from '../../services/WorkflowProtocol'
import type { LLMNode } from '../nodes/LLM_Node'
import type { LoopStartNode } from '../nodes/LoopStart_Node'
import { NodeType, type WorkflowNodes, createNode } from '../nodes/Nodes'

interface IndexedNodes {
    byId: Map<string, WorkflowNodes>
    allIds: string[]
}

/* function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

const CODY_NODES_DIR = '.cody/nodes' */

export interface UseCustomNodes {
    onSaveCustomNode: (node: WorkflowNodes, name: string) => Promise<void>
    //getCustomNodes: () => Promise<WorkflowNodes[]>
    //renameCustomNode: (id: string, newName: string) => Promise<void>
    //deleteCustomNode: (id: string) => Promise<void>
    //customNodes: WorkflowNodes[]
}

/**
 * A hook that provides utilities for managing nodes in a React Flow workflow.
 *
 * This hook handles node operations such as adding, updating, and dragging nodes, as well as
 * managing the state of the selected node and the nodes being moved.
 *
 * @param vscodeAPI - A wrapper for the VSCode API, used to post messages back to the extension.
 * @param nodes - The current set of nodes in the workflow.
 * @param setNodes - A function to update the set of nodes.
 * @param selectedNode - The currently selected node, or null if no node is selected.
 * @param setSelectedNode - A function to update the selected node.
 * @returns An object containing various functions and state related to node operations.
 */
export const useNodeOperations = (
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, ExtensionToWorkflow>,
    nodes: WorkflowNodes[],
    setNodes: React.Dispatch<React.SetStateAction<WorkflowNodes[]>>,
    selectedNodes: WorkflowNodes[],
    setSelectedNodes: React.Dispatch<React.SetStateAction<WorkflowNodes[]>>,
    activeNode: WorkflowNodes | null,
    setActiveNode: React.Dispatch<React.SetStateAction<WorkflowNodes | null>>
) => {
    const [movingNodeId, setMovingNodeId] = useState<string | null>(null)
    const flowInstance = useReactFlow()
    const createIndexedNodes = (nodes: WorkflowNodes[]): IndexedNodes => ({
        byId: new Map(nodes.map(node => [node.id, node])),
        allIds: nodes.map(node => node.id),
    })
    const indexedNodes = useMemo(() => createIndexedNodes(nodes), [nodes, createIndexedNodes])

    const onNodesChange = useCallback(
        (changes: NodeChange[]) => {
            const dragChange = changes.find(
                change => change.type === 'position' && 'dragging' in change && change.dragging
            ) as
                | {
                      id: string
                      type: 'position'
                      dragging: boolean
                      position?: { x: number; y: number }
                      event?: MouseEvent
                  }
                | undefined

            if (dragChange?.event?.shiftKey && dragChange.dragging && !movingNodeId) {
                return
            }

            if (dragChange) {
                setMovingNodeId(dragChange.id)
            } else if (movingNodeId) {
                setMovingNodeId(null)
            }

            const updatedNodes = applyNodeChanges(changes, nodes) as typeof nodes
            setNodes(updatedNodes)

            // Update the selected nodes when changes occur
            if (selectedNodes.length > 0) {
                const updatedSelectedNodes = selectedNodes
                    .map(node => indexedNodes.byId.get(node.id))
                    .filter(Boolean) as WorkflowNodes[]

                setSelectedNodes(updatedSelectedNodes)
            }

            // Update the active node if it exists
            if (activeNode) {
                const updatedActiveNode = indexedNodes.byId.get(activeNode.id)
                setActiveNode(updatedActiveNode || null)
            }
        },
        [
            selectedNodes,
            activeNode,
            nodes,
            movingNodeId,
            setNodes,
            setSelectedNodes,
            setActiveNode,
            indexedNodes,
        ]
    )

    const onNodeDragStart = useCallback(
        (event: React.MouseEvent, node: WorkflowNodes) => {
            if (event.shiftKey) {
                const sourceNode = indexedNodes.byId.get(node.id)
                if (!sourceNode) return
                const newNode = createNode({
                    type: sourceNode.type,
                    data: {
                        ...sourceNode.data,
                        title: sourceNode.data.title,
                        content: sourceNode.data.content,
                        active: sourceNode.data.active,
                    },

                    position: {
                        x: sourceNode.position.x,
                        y: sourceNode.position.y,
                    },
                }) as WorkflowNodes

                // Copy node-specific data
                switch (sourceNode.type) {
                    case NodeType.LLM: {
                        const llmSource = sourceNode as LLMNode
                        node.data = {
                            ...newNode.data,
                            temperature: llmSource.data.temperature,
                            maxTokens: llmSource.data.maxTokens,
                            model: llmSource.data.model,
                        }
                        break
                    }

                    case NodeType.CLI:
                    case NodeType.PREVIEW:
                    case NodeType.INPUT:
                    case NodeType.CODY_OUTPUT:
                    case NodeType.LOOP_START: {
                        const loopStartData = sourceNode as LoopStartNode
                        newNode.data = {
                            ...newNode.data,
                            iterations: loopStartData.data.iterations,
                            loopVariable: loopStartData.data.loopVariable,
                        }
                        break
                    }
                    case NodeType.LOOP_END:
                    case NodeType.SEARCH_CONTEXT:
                        newNode.data.content = sourceNode.data.content
                        break
                }

                setNodes(current => [...current, newNode])
                setMovingNodeId(newNode.id)
                event.stopPropagation()
            }
        },
        [indexedNodes, setNodes]
    )

    const onNodeAdd = useCallback(
        (nodeOrLabel: WorkflowNodes | string, nodeType?: NodeType) => {
            // Existing logic for creating node from label + type
            const flowElement = document.querySelector('.react-flow')
            const flowBounds = flowElement?.getBoundingClientRect()

            const centerPosition = flowInstance.screenToFlowPosition({
                x: flowBounds ? flowBounds.x + flowBounds.width / 2 : 0,
                y: flowBounds ? flowBounds.y + flowBounds.height / 2 : 0,
            })
            if (typeof nodeOrLabel === 'string') {
                const newNode = createNode({
                    type: nodeType!,
                    data: {
                        title: nodeOrLabel,
                        content: '',
                        active: true,
                    },
                    position: centerPosition,
                }) as WorkflowNodes

                // Set type-specific defaults
                switch (nodeType) {
                    case NodeType.LLM:
                        newNode.data = {
                            ...newNode.data,
                            temperature: 0.0,
                            maxTokens: 1000,
                            model: undefined,
                        }
                        break
                    case NodeType.PREVIEW:
                    case NodeType.INPUT:
                        newNode.data.content = ''
                        break
                    case NodeType.LOOP_START:
                        newNode.data = {
                            ...newNode.data,
                            iterations: 1,
                            loopVariable: 'loop',
                        }
                        break
                    case NodeType.SEARCH_CONTEXT:
                        newNode.data = {
                            ...newNode.data,
                            local_remote: false,
                        }
                        break
                }

                setNodes(nodes => [...nodes, newNode])
            } else {
                // Direct node object provided - override position
                const nodeWithId = {
                    ...nodeOrLabel,
                    id: uuidv4(),
                    position: centerPosition, // Override position to center
                }
                setNodes(nodes => [...nodes, nodeWithId])
            }
        },
        [flowInstance, setNodes]
    )

    const onNodeUpdate = useCallback(
        (nodeId: string, data: Partial<WorkflowNodes['data']>) => {
            // First find the node to update
            const nodeToUpdate = nodes.find(n => n.id === nodeId)
            if (!nodeToUpdate) return

            // Create the updated node
            let updatedNode: WorkflowNodes
            if (nodeToUpdate.type === NodeType.LLM) {
                const llmNode = nodeToUpdate as LLMNode
                const updatedLLMData: Partial<LLMNode['data']> = { ...llmNode.data, ...data }

                if ('model' in data && data.model) {
                    updatedLLMData.model = { ...data.model }
                }

                updatedNode = {
                    ...llmNode,
                    data: updatedLLMData as LLMNode['data'],
                }
            } else {
                updatedNode = {
                    ...nodeToUpdate,
                    data: { ...nodeToUpdate.data, ...data },
                }
            }

            // Handle token calculation for Preview nodes
            if (nodeToUpdate.type === NodeType.PREVIEW && 'content' in data) {
                vscodeAPI.postMessage({
                    type: 'calculate_tokens',
                    data: {
                        text: data.content || '',
                        nodeId,
                    },
                })
            }

            // Batch all state updates to execute at once
            // This prevents the multiple re-renders that are causing the cursor jump

            unstable_batchedUpdates(() => {
                // Update main nodes array
                setNodes(currentNodes => currentNodes.map(n => (n.id === nodeId ? updatedNode : n)))

                // Update selected nodes if needed
                if (selectedNodes.some(n => n.id === nodeId)) {
                    setSelectedNodes(prev => prev.map(n => (n.id === nodeId ? updatedNode : n)))
                }

                // Update active node if needed
                if (activeNode?.id === nodeId) {
                    setActiveNode(updatedNode)
                }
            })
        },
        [nodes, selectedNodes, activeNode, setNodes, setSelectedNodes, setActiveNode, vscodeAPI]
    )

    return {
        movingNodeId,
        onNodesChange,
        onNodeDragStart,
        onNodeAdd,
        onNodeUpdate,
        indexedNodes,
    }
}

export const useCustomNodes = (
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, ExtensionToWorkflow>
) => {
    const onGetCustomNodes = useCallback(() => {
        vscodeAPI.postMessage({
            type: 'get_custom_nodes',
        })
    }, [vscodeAPI])

    const onSaveCustomNode = useCallback(
        (node: WorkflowNodes) => {
            vscodeAPI.postMessage({
                type: 'save_customNode',
                data: node,
            })
        },
        [vscodeAPI]
    )

    const onDeleteCustomNode = useCallback(
        (nodeTitle: string) => {
            vscodeAPI.postMessage({
                type: 'delete_customNode',
                data: nodeTitle,
            })
        },
        [vscodeAPI]
    )

    const onRenameCustomNode = useCallback(
        (oldNodeTitle: string, newNodeTitle: string) => {
            vscodeAPI.postMessage({
                type: 'rename_customNode',
                data: {
                    oldNodeTitle: oldNodeTitle,
                    newNodeTitle: newNodeTitle,
                },
            })
        },
        [vscodeAPI]
    )

    useEffect(() => {
        onGetCustomNodes()
    }, [onGetCustomNodes])
    return {
        onSaveCustomNode,
        onDeleteCustomNode,
        onRenameCustomNode,
    }
}
