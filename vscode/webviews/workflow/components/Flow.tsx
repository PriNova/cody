import {
    Background,
    Controls,
    type EdgeChange,
    type NodeChange,
    ReactFlow,
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    useOnSelectionChange,
    useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GenericVSCodeWrapper } from '@sourcegraph/cody-shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkflowFromExtension, WorkflowToExtension } from '../services/WorkflowProtocol'
import { CustomOrderedEdge, type Edge } from './CustomOrderedEdge'
import styles from './Flow.module.css'
import { HelpModal } from './HelpModal'
import { WorkflowSidebar } from './WorkflowSidebar'
import { NodeType, type WorkflowNode, createNode, defaultWorkflow, nodeTypes } from './nodes/Nodes'

export const Flow: React.FC<{
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, WorkflowFromExtension>
}> = ({ vscodeAPI }) => {
    // Node-related state
    const [nodes, setNodes] = useState(defaultWorkflow.nodes)
    const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null)
    const [nodeResults, setNodeResults] = useState<Map<string, string>>(new Map())

    // Edge-related state
    const [edges, setEdges] = useState(defaultWorkflow.edges)

    // UI state
    const [isHelpOpen, setIsHelpOpen] = useState(false)

    // Execution state

    const edgeTypes = {
        'ordered-edge': CustomOrderedEdge,
    }

    // #region 1. Execution State

    const useWorkflowExecution = (
        vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, WorkflowFromExtension>,
        nodes: WorkflowNode[],
        edges: Edge[]
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
        }, [])

        const onExecute = useCallback(() => {
            const invalidNodes = nodes.filter(node => {
                if (node.type === NodeType.LLM) {
                    return !node.data.prompt || node.data.prompt.trim() === ''
                }
                return false
            })

            if (invalidNodes.length > 0) {
                const newErrors = new Map<string, string>()
                for (const node of invalidNodes) {
                    const errorMessage =
                        node.type === NodeType.CLI
                            ? 'Command field is required'
                            : 'Prompt field is required'
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

    const {
        isExecuting,
        executingNodeId,
        nodeErrors,
        interruptedNodeIds,
        onExecute,
        onAbort,
        resetExecutionState,
        setExecutingNodeId,
        setIsExecuting,
        setInterruptedNodeIds,
        setNodeErrors,
    } = useWorkflowExecution(vscodeAPI, nodes, edges)

    // #endregion

    // #region 2. Node Operations

    // Handles all node-related state changes and updates
    const useNodeOperations = (
        nodes: WorkflowNode[],
        setNodes: React.Dispatch<React.SetStateAction<WorkflowNode[]>>,
        selectedNode: WorkflowNode | null,
        setSelectedNode: React.Dispatch<React.SetStateAction<WorkflowNode | null>>
    ) => {
        const [movingNodeId, setMovingNodeId] = useState<string | null>(null)
        const flowInstance = useReactFlow()

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

                if (selectedNode) {
                    const updatedSelectedNode = updatedNodes.find(
                        (node: { id: string }) => node.id === selectedNode.id
                    )
                    setSelectedNode(updatedSelectedNode || null)
                }
            },
            [selectedNode, nodes, movingNodeId, setNodes, setSelectedNode]
        )

        const onNodeDragStart = useCallback(
            (event: React.MouseEvent, node: WorkflowNode) => {
                if (event.shiftKey) {
                    const newNode = createNode({
                        type: node.type,
                        title: node.data.title,
                        position: {
                            x: node.position.x,
                            y: node.position.y,
                        },
                    })

                    // Copy node-specific data
                    if (node.type === NodeType.CLI) {
                        newNode.data.command = node.data.command
                    } else if (node.type === NodeType.LLM) {
                        newNode.data.prompt = node.data.prompt
                    } else if (node.type === NodeType.PREVIEW || node.type === NodeType.INPUT) {
                        newNode.data.content = node.data.content
                    }

                    setNodes(current => [...current, newNode])
                    setMovingNodeId(newNode.id)
                    event.stopPropagation()
                }
            },
            [setNodes]
        )

        const onNodeAdd = useCallback(
            (nodeLabel: string, nodeType: NodeType) => {
                const flowElement = document.querySelector('.react-flow')
                const flowBounds = flowElement?.getBoundingClientRect()

                const centerPosition = flowInstance.screenToFlowPosition({
                    x: flowBounds ? flowBounds.x + flowBounds.width / 2 : 0,
                    y: flowBounds ? flowBounds.y + flowBounds.height / 2 : 0,
                })

                const newNode = createNode({
                    type: nodeType,
                    title: nodeLabel,
                    position: centerPosition,
                })

                if ([NodeType.PREVIEW, NodeType.INPUT].includes(nodeType)) {
                    newNode.data.content = ''
                }

                setNodes(nodes => [...nodes, newNode])
            },
            [flowInstance, setNodes]
        )

        const onNodeUpdate = useCallback(
            (nodeId: string, data: Partial<WorkflowNode['data']>) => {
                setNodes(currentNodes =>
                    currentNodes.map(node => {
                        if (node.id === nodeId) {
                            const updatedNode = {
                                ...node,
                                data: { ...node.data, ...data },
                            }
                            if (selectedNode?.id === nodeId) {
                                setSelectedNode(updatedNode)
                            }
                            return updatedNode
                        }
                        return node
                    })
                )
            },
            [selectedNode, setNodes, setSelectedNode]
        )

        return {
            movingNodeId,
            onNodesChange,
            onNodeDragStart,
            onNodeAdd,
            onNodeUpdate,
        }
    }

    const { movingNodeId, onNodesChange, onNodeDragStart, onNodeAdd, onNodeUpdate } = useNodeOperations(
        nodes,
        setNodes,
        selectedNode,
        setSelectedNode
    )
    // #endregion

    // #region 3. Edge Operations

    //Manages connections between nodes
    const useEdgeOperations = (
        edges: Edge[],
        setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
        nodes: WorkflowNode[]
    ) => {
        // Memoize the topological sort results
        const sortedNodes = useMemo(() => topologicalEdgeSort(nodes, edges), [nodes, edges])

        // Memoize the edge order map calculation
        const edgeOrder = useMemo(() => {
            const orderMap = new Map<string, number>()
            const edgesByTarget = new Map<string, Edge[]>()

            // Group edges by target
            for (const edge of edges) {
                const targetEdges = edgesByTarget.get(edge.target) || []
                targetEdges.push(edge)
                edgesByTarget.set(edge.target, targetEdges)
            }

            // Calculate orders using our memoized sorted nodes
            for (const targetEdges of edgesByTarget.values()) {
                const sortedEdges = targetEdges.sort((a, b) => {
                    const aIndex = sortedNodes.findIndex(node => node.id === a.source)
                    const bIndex = sortedNodes.findIndex(node => node.id === b.source)
                    return aIndex - bIndex
                })

                sortedEdges.forEach((edge, index) => {
                    orderMap.set(edge.id, index + 1)
                })
            }

            return orderMap
        }, [edges, sortedNodes])

        // Memoize the final edges with order data
        const edgesWithOrder = useMemo(
            () =>
                edges.map(edge => ({
                    ...edge,
                    type: 'ordered-edge',
                    data: {
                        orderNumber: edgeOrder.get(edge.id) || 0,
                    },
                })),
            [edges, edgeOrder]
        )

        const onEdgesChange = useCallback(
            (changes: EdgeChange[]) => setEdges(eds => applyEdgeChanges(changes, eds) as typeof edges),
            [setEdges]
        )

        const onConnect = useCallback((params: any) => setEdges(eds => addEdge(params, eds)), [setEdges])

        return {
            onEdgesChange,
            onConnect,
            getEdgesWithOrder: edgesWithOrder,
        }
    }
    const { onEdgesChange, onConnect, getEdgesWithOrder } = useEdgeOperations(edges, setEdges, nodes)
    //#endregion

    // #region 4. Message Handlers

    const useMessageHandler = (
        nodes: WorkflowNode[],
        setNodes: React.Dispatch<React.SetStateAction<WorkflowNode[]>>,
        setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
        setNodeErrors: React.Dispatch<React.SetStateAction<Map<string, string>>>,
        setNodeResults: React.Dispatch<React.SetStateAction<Map<string, string>>>,
        setInterruptedNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>,
        setExecutingNodeId: React.Dispatch<React.SetStateAction<string | null>>,
        setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>,
        onNodeUpdate: (nodeId: string, data: Partial<WorkflowNode['data']>) => void
    ) => {
        useEffect(() => {
            const messageHandler = (event: MessageEvent<WorkflowFromExtension>) => {
                switch (event.data.type) {
                    case 'workflow_loaded':
                        if (event.data.data) {
                            setNodes(event.data.data.nodes)
                            setEdges(event.data.data.edges)
                            setNodeErrors(new Map())
                        }
                        break

                    case 'node_execution_status':
                        if (event.data.data?.nodeId && event.data.data?.status) {
                            if (event.data.data.status === 'interrupted') {
                                setInterruptedNodeIds(prev => {
                                    prev.add(event.data.data?.nodeId ?? '')
                                    return new Set(prev)
                                })
                            }

                            if (event.data.data.status === 'running') {
                                setExecutingNodeId(event.data.data.nodeId)
                                setNodeErrors(prev => {
                                    const updated = new Map(prev)
                                    updated.delete(event.data.data?.nodeId ?? '')
                                    return updated
                                })
                            } else if (event.data.data.status === 'error') {
                                setExecutingNodeId(null)
                                setNodeErrors(prev =>
                                    new Map(prev).set(
                                        event.data.data?.nodeId ?? '',
                                        event.data.data?.result ?? ''
                                    )
                                )
                            } else if (event.data.data.status === 'completed') {
                                setExecutingNodeId(null)
                                const node = nodes.find(n => n.id === event.data.data?.nodeId)
                                if (node?.type === NodeType.PREVIEW) {
                                    onNodeUpdate(node.id, { content: event.data.data?.result })
                                }
                            } else {
                                setExecutingNodeId(null)
                            }

                            setNodeResults(prev =>
                                new Map(prev).set(
                                    event.data.data?.nodeId ?? '',
                                    event.data.data?.result ?? ''
                                )
                            )
                        }
                        break

                    case 'execution_started':
                        setIsExecuting(true)
                        break

                    case 'execution_completed':
                        setIsExecuting(false)
                        break
                }
            }

            window.addEventListener('message', messageHandler)
            return () => window.removeEventListener('message', messageHandler)
        }, [
            nodes,
            onNodeUpdate,
            setEdges,
            setExecutingNodeId,
            setInterruptedNodeIds,
            setIsExecuting,
            setNodeErrors,
            setNodeResults,
            setNodes,
        ])
    }

    useMessageHandler(
        nodes,
        setNodes,
        setEdges,
        setNodeErrors,
        setNodeResults,
        setInterruptedNodeIds,
        setExecutingNodeId,
        setIsExecuting,
        onNodeUpdate
    )

    // #endregion

    // #region 5. SideBar Resizing

    const useSidebarResize = (initialWidth = 256, minWidth = 200, maxWidth = 600) => {
        const [sidebarWidth, setSidebarWidth] = useState(initialWidth)
        const [isResizing, setIsResizing] = useState(false)
        const [startX, setStartX] = useState(0)
        const [startWidth, setStartWidth] = useState(0)

        const handleMouseDown = useCallback(
            (e: React.MouseEvent) => {
                setIsResizing(true)
                setStartX(e.clientX)
                setStartWidth(sidebarWidth)
                e.preventDefault()
            },
            [sidebarWidth]
        )

        const handleMouseMove = useCallback(
            (e: MouseEvent) => {
                if (!isResizing) return
                const delta = e.clientX - startX
                const newWidth = Math.min(Math.max(startWidth + delta, minWidth), maxWidth)
                setSidebarWidth(newWidth)
            },
            [isResizing, startX, startWidth, minWidth, maxWidth]
        )

        const handleMouseUp = useCallback(() => {
            setIsResizing(false)
        }, [])

        useEffect(() => {
            if (isResizing) {
                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
            }

            return () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
            }
        }, [isResizing, handleMouseMove, handleMouseUp])

        return {
            sidebarWidth,
            handleMouseDown,
        }
    }

    const { sidebarWidth, handleMouseDown } = useSidebarResize()

    // #endregion

    // #region 6. Selection Management

    const useInteractionHandling = (
        setSelectedNode: React.Dispatch<React.SetStateAction<WorkflowNode | null>>
    ) => {
        // Handle node selection changes from ReactFlow
        useOnSelectionChange({
            onChange: ({ nodes }) => {
                if (nodes.length === 0) {
                    setSelectedNode(null)
                }
            },
        })

        // Handle direct node clicks
        const onNodeClick = useCallback(
            (event: React.MouseEvent, node: WorkflowNode) => {
                event.stopPropagation()
                setSelectedNode(node)
            },
            [setSelectedNode]
        )

        const handleBackgroundClick = useCallback(
            (event: React.MouseEvent | React.KeyboardEvent) => {
                if (event.type === 'click' || (event as React.KeyboardEvent).key === 'Enter') {
                    setSelectedNode(null)
                }
            },
            [setSelectedNode]
        )

        const handleBackgroundKeyDown = useCallback(
            (event: React.KeyboardEvent) => {
                if (event.key === 'Enter') {
                    setSelectedNode(null)
                }
            },
            [setSelectedNode]
        )

        return { onNodeClick, handleBackgroundClick, handleBackgroundKeyDown }
    }

    const { onNodeClick, handleBackgroundClick, handleBackgroundKeyDown } =
        useInteractionHandling(setSelectedNode)

    // #endregion

    // #region 7. Node State Transformations

    const useNodeStateTransformation = (
        nodes: WorkflowNode[],
        selectedNode: WorkflowNode | null,
        movingNodeId: string | null,
        executingNodeId: string | null,
        nodeErrors: Map<string, string>,
        nodeResults: Map<string, string>,
        interruptedNodeIds: Set<string>
    ) => {
        return useMemo(
            () =>
                nodes.map(node => ({
                    ...node,
                    selected: node.id === selectedNode?.id,
                    data: {
                        ...node.data,
                        moving: node.id === movingNodeId,
                        executing: node.id === executingNodeId,
                        interrupted: interruptedNodeIds.has(node.id),
                        error: nodeErrors.has(node.id),
                        result: nodeResults.get(node.id),
                    },
                })),
            [
                nodes,
                selectedNode,
                movingNodeId,
                executingNodeId,
                nodeErrors,
                nodeResults,
                interruptedNodeIds,
            ]
        )
    }

    const nodesWithState = useNodeStateTransformation(
        nodes,
        selectedNode,
        movingNodeId,
        executingNodeId,
        nodeErrors,
        nodeResults,
        interruptedNodeIds
    )

    // #endregion

    // #region 8. Workflow Actions

    const useWorkflowActions = (
        vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, WorkflowFromExtension>,
        nodes: WorkflowNode[],
        edges: Edge[]
    ) => {
        const onSave = useCallback(() => {
            const workflowData = {
                nodes,
                edges,
                version: '1.0.0',
            }
            vscodeAPI.postMessage({
                type: 'save_workflow',
                data: workflowData,
            })
        }, [nodes, edges, vscodeAPI])

        const onLoad = useCallback(() => {
            vscodeAPI.postMessage({
                type: 'load_workflow',
            })
        }, [vscodeAPI])

        return { onSave, onLoad }
    }

    const { onSave, onLoad } = useWorkflowActions(vscodeAPI, nodes, edges)

    // #endregion

    return (
        <div className={`tw-flex tw-h-screen tw-border-2 tw-border-solid tw-border-[var(--vscode-panel-border)]  tw-text-[14px]`}>
            <div
                style={{ width: sidebarWidth + 'px', flexShrink: 0 }}
                className="tw-border-r tw-border-solid tw-border-[var(--vscode-panel-border)] tw-bg-[var(--vscode-sideBar-background)]"
            >
                <WorkflowSidebar
                    onNodeAdd={onNodeAdd}
                    selectedNode={selectedNode}
                    onNodeUpdate={onNodeUpdate}
                    onSave={onSave}
                    onLoad={onLoad}
                    onExecute={onExecute}
                    onClear={resetExecutionState}
                    isExecuting={isExecuting}
                    onAbort={onAbort}
                />
            </div>
            <div
                className="tw-w-2 hover:tw-w-2 tw-bg-[var(--vscode-panel-border)] hover:tw-bg-[var(--vscode-textLink-activeForeground)] tw-cursor-ew-resize tw-select-none tw-transition-colors tw-transition-width tw-shadow-sm"
                onMouseDown={handleMouseDown}
            />
            <div
                className="tw-flex-1 tw-bg-[var(--vscode-editor-background)] tw-shadow-inner"
                onClick={handleBackgroundClick}
                onKeyDown={handleBackgroundKeyDown}
                role="button"
                tabIndex={0}
            >
                <div className="tw-w-full tw-h-full tw-border-l tw-border-solid tw-border-[var(--vscode-panel-border)]">
                    <ReactFlow
                        nodes={nodesWithState}
                        edges={getEdgesWithOrder}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onNodeDragStart={onNodeDragStart}
                        deleteKeyCode={['Backspace', 'Delete']}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        fitView
                    >
                        <Background />
                        <Controls className={styles.controls}>
                            <button
                                type="button"
                                className="react-flow__controls-button"
                                onClick={() => setIsHelpOpen(true)}
                                title="Help"
                            >
                                ?
                            </button>
                        </Controls>
                        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
                    </ReactFlow>
                </div>
            </div>
        </div>
    )
}

/**
 * Performs a topological sort of the given workflow nodes and edges, returning the nodes in a sorted order.
 *
 * The topological sort ensures that nodes with no dependencies are placed first, and the order of the sorted nodes
 * respects the edges between them. This is useful for ensuring that the workflow execution order is correct.
 *
 * @param nodes - The workflow nodes to sort.
 * @param edges - The edges between the workflow nodes.
 * @returns The workflow nodes in a sorted order.
 */
function topologicalEdgeSort(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
    const graph = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    // Initialize
    for (const node of nodes) {
        graph.set(node.id, [])
        inDegree.set(node.id, 0)
    }

    // Build graph
    for (const edge of edges) {
        graph.get(edge.source)?.push(edge.target)
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
    }

    // Find nodes with no dependencies but sort them based on their edge connections
    const sourceNodes = nodes.filter(node => inDegree.get(node.id) === 0)

    // Sort source nodes based on edge order
    const sortedSourceNodes = sourceNodes.sort((a, b) => {
        const aEdgeIndex = edges.findIndex(edge => edge.source === a.id)
        const bEdgeIndex = edges.findIndex(edge => edge.source === b.id)
        return aEdgeIndex - bEdgeIndex
    })

    const queue = sortedSourceNodes.map(node => node.id)
    const result: string[] = []

    while (queue.length > 0) {
        const nodeId = queue.shift()!
        result.push(nodeId)

        const neighbors = graph.get(nodeId)
        if (neighbors) {
            for (const neighbor of neighbors) {
                inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1)
                if (inDegree.get(neighbor) === 0) {
                    queue.push(neighbor)
                }
            }
        }
    }

    return result.map(id => nodes.find(node => node.id === id)!).filter(Boolean)
}
