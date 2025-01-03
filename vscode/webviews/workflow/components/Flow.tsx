import { Background, Controls, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GenericVSCodeWrapper } from '@sourcegraph/cody-shared'
import type React from 'react'
import { useMemo, useState } from 'react'
import type { WorkflowFromExtension, WorkflowToExtension } from '../services/WorkflowProtocol'
import { CustomOrderedEdge } from './CustomOrderedEdge'
import styles from './Flow.module.css'
import { HelpModal } from './HelpModal'
import { RightSidebar } from './RightSidebar'
import { WorkflowSidebar } from './WorkflowSidebar'
import { useEdgeOperations } from './hooks/edgeOperations'
import { useMessageHandler } from './hooks/messageHandling'
import { useNodeOperations } from './hooks/nodeOperations'
import { memoizedTopologicalSort, useNodeStateTransformation } from './hooks/nodeStateTransforming'
import { useInteractionHandling } from './hooks/selectionHandling'
import { useRightSidebarResize, useSidebarResize } from './hooks/sidebarResizing'
import { useWorkflowActions } from './hooks/workflowActions'
import { useWorkflowExecution } from './hooks/workflowExecution'
import { type WorkflowNodes, defaultWorkflow, nodeTypes } from './nodes/Nodes'

/**
 * Flow component represents the main workflow visualization and interaction interface.
 * It manages the state and rendering of workflow nodes, edges, and associated UI elements.
 *
 * @component
 * @param {Object} props - Component properties
 * @param {GenericVSCodeWrapper<WorkflowToExtension, WorkflowFromExtension>} props.vscodeAPI - VSCode API wrapper for communication between webview and extension
 * @returns {React.ReactElement} Rendered workflow interface with ReactFlow, sidebars, and controls
 */
export const Flow: React.FC<{
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, WorkflowFromExtension>
}> = ({ vscodeAPI }) => {
    // Node-related state
    const [nodes, setNodes] = useState<WorkflowNodes[]>(defaultWorkflow.nodes)
    const [selectedNode, setSelectedNode] = useState<WorkflowNodes | null>(null)
    const [nodeResults, setNodeResults] = useState<Map<string, string>>(new Map())
    const [pendingApprovalNodeId, setPendingApprovalNodeId] = useState<string | null>(null)

    // Edge-related state
    const [edges, setEdges] = useState(defaultWorkflow.edges)

    // UI state
    const [isHelpOpen, setIsHelpOpen] = useState(false)

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
    } = useWorkflowExecution(vscodeAPI, nodes, edges, setNodes, setEdges)

    const { movingNodeId, onNodesChange, onNodeDragStart, onNodeAdd, onNodeUpdate } = useNodeOperations(
        vscodeAPI,
        nodes,
        setNodes,
        selectedNode,
        setSelectedNode
    )

    const { onEdgesChange, onConnect, getEdgesWithOrder } = useEdgeOperations(edges, setEdges, nodes)

    const { onSave, onLoad, calculatePreviewNodeTokens, handleNodeApproval } = useWorkflowActions(
        vscodeAPI,
        nodes,
        edges,
        setPendingApprovalNodeId,
        setNodeErrors,
        setIsExecuting
    )

    useMessageHandler(
        nodes,
        setNodes,
        setEdges,
        setNodeErrors,
        setNodeResults,
        setInterruptedNodeIds,
        setExecutingNodeId,
        setIsExecuting,
        onNodeUpdate,
        calculatePreviewNodeTokens,
        setPendingApprovalNodeId
    )

    const { sidebarWidth, handleMouseDown } = useSidebarResize()

    const { rightSidebarWidth, handleMouseDown: handleRightSidebarMouseDown } = useRightSidebarResize()

    const { onNodeClick, handleBackgroundClick, handleBackgroundKeyDown } =
        useInteractionHandling(setSelectedNode)

    const nodesWithState = useNodeStateTransformation(
        nodes,
        selectedNode,
        movingNodeId,
        executingNodeId,
        nodeErrors,
        nodeResults,
        interruptedNodeIds,
        edges
    ).map(node => ({
        ...node,
        data: {
            ...node.data,
        },
    }))

    // Recalculate sortedNodes on each render
    const sortedNodes = useMemo(
        () => memoizedTopologicalSort(nodesWithState, edges),
        [nodesWithState, edges]
    )

    return (
        <div className="tw-flex tw-h-screen tw-w-full tw-border-2 tw-border-solid tw-border-[var(--vscode-panel-border)] tw-text-[14px] tw-overflow-hidden">
            <div
                style={{ width: sidebarWidth + 'px' }}
                className="tw-flex-shrink-0 tw-border-r tw-border-solid tw-border-[var(--vscode-panel-border)] tw-bg-[var(--vscode-sideBar-background)] tw-overflow-y-auto tw-h-full"
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
                className="tw-w-2 hover:tw-w-2 tw-bg-[var(--vscode-panel-border)] hover:tw-bg-[var(--vscode-textLink-activeForeground)] tw-cursor-ew-resize"
                onMouseDown={handleMouseDown}
            />
            <div
                className="tw-flex-1 tw-bg-[var(--vscode-editor-background)] tw-shadow-inner tw-h-full tw-overflow-hidden"
                onClick={handleBackgroundClick}
                onKeyDown={handleBackgroundKeyDown}
                role="button"
                tabIndex={0}
            >
                <div className="tw-flex tw-flex-1 tw-h-full">
                    <div className="tw-flex-1 tw-bg-[var(--vscode-editor-background)] tw-h-full">
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
                            edgeTypes={{
                                'ordered-edge': props => <CustomOrderedEdge {...props} edges={edges} />,
                            }}
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

                    <div
                        className="tw-w-2 hover:tw-w-2 tw-bg-[var(--vscode-panel-border)] hover:tw-bg-[var(--vscode-textLink-activeForeground)] tw-cursor-ew-resize tw-select-none tw-transition-colors tw-transition-width tw-shadow-sm"
                        onMouseDown={handleRightSidebarMouseDown}
                    />
                    <div
                        style={{ width: rightSidebarWidth + 'px' }}
                        className="tw-flex-shrink-0 tw-border-r tw-border-solid tw-border-[var(--vscode-panel-border)] tw-bg-[var(--vscode-sideBar-background)] tw-h-full tw-overflow-y-auto"
                    >
                        <RightSidebar
                            sortedNodes={sortedNodes}
                            nodeResults={nodeResults}
                            executingNodeId={executingNodeId}
                            pendingApprovalNodeId={pendingApprovalNodeId}
                            onApprove={handleNodeApproval}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
