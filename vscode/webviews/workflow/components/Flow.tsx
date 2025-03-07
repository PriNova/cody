import { Background, Controls, ReactFlow, SelectionMode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GenericVSCodeWrapper, Model } from '@sourcegraph/cody-shared'
import type React from 'react'
import { useMemo, useState } from 'react'
import type { ExtensionToWorkflow, WorkflowToExtension } from '../services/WorkflowProtocol'
import { CustomOrderedEdgeComponent } from './CustomOrderedEdge'
import styles from './Flow.module.css'
import { HelpModal } from './HelpModal'
import { RightSidebar } from './RightSidebar'
import { WorkflowSidebar } from './WorkflowSidebar'
import { useEdgeOperations } from './hooks/edgeOperations'
import { useMessageHandler } from './hooks/messageHandling'
import { useCustomNodes, useNodeOperations } from './hooks/nodeOperations'
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
 * @param {GenericVSCodeWrapper<WorkflowToExtension, ExtensionToWorkflow>} props.vscodeAPI - VSCode API wrapper for communication between webview and extension
 * @returns {React.ReactElement} Rendered workflow interface with ReactFlow, sidebars, and controls
 */
export const Flow: React.FC<{
    vscodeAPI: GenericVSCodeWrapper<WorkflowToExtension, ExtensionToWorkflow>
}> = ({ vscodeAPI }) => {
    // Node-related state
    const [nodes, setNodes] = useState<WorkflowNodes[]>(defaultWorkflow.nodes)
    const [selectedNodes, setSelectedNodes] = useState<WorkflowNodes[]>([])
    const [activeNode, setActiveNode] = useState<WorkflowNodes | null>(null)
    const [nodeResults, setNodeResults] = useState<Map<string, string>>(new Map())
    const [pendingApprovalNodeId, setPendingApprovalNodeId] = useState<string | null>(null)
    const [models, setModels] = useState<Model[]>([])
    const [customNodes, setCustomNodes] = useState<WorkflowNodes[]>([])

    // Edge-related state
    const [edges, setEdges] = useState(defaultWorkflow.edges)

    // UI state
    const [isHelpOpen, setIsHelpOpen] = useState(false)

    const { onEdgesChange, onConnect, onEdgesDelete, orderedEdges } = useEdgeOperations(
        edges,
        setEdges,
        nodes
    )

    const { movingNodeId, onNodesChange, onNodeDragStart, onNodeAdd, onNodeUpdate } = useNodeOperations(
        vscodeAPI,
        nodes,
        setNodes,
        selectedNodes,
        setSelectedNodes,
        activeNode,
        setActiveNode
    )

    const {
        isExecuting,
        executingNodeId,
        nodeErrors,
        interruptedNodeId,
        onExecute,
        onAbort,
        resetExecutionState,
        setExecutingNodeId,
        setIsExecuting,
        setInterruptedNodeId,
        setNodeErrors,
    } = useWorkflowExecution(vscodeAPI, nodes, edges, setNodes, setEdges)

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
        setInterruptedNodeId,
        setExecutingNodeId,
        setIsExecuting,
        onNodeUpdate,
        calculatePreviewNodeTokens,
        setPendingApprovalNodeId,
        setModels,
        vscodeAPI,
        setCustomNodes
    )

    const { sidebarWidth, handleMouseDown } = useSidebarResize()

    const { rightSidebarWidth, handleMouseDown: handleRightSidebarMouseDown } = useRightSidebarResize()

    const { onNodeClick, handleBackgroundClick, handleBackgroundKeyDown } = useInteractionHandling(
        setSelectedNodes,
        setActiveNode
    )

    const nodesWithState = useNodeStateTransformation(
        nodes,
        selectedNodes,
        movingNodeId,
        executingNodeId,
        nodeErrors,
        nodeResults,
        interruptedNodeId,
        edges
    )

    const { onSaveCustomNode, onDeleteCustomNode, onRenameCustomNode } = useCustomNodes(vscodeAPI)

    // Recalculate sortedNodes on each render
    const sortedNodes = useMemo(() => {
        const sorted = memoizedTopologicalSort(nodesWithState, edges)
        // Preserve all node data including active state
        return sorted.map(node => ({
            ...node,
            data: { ...node.data }, // Ensure data object is properly cloned
        }))
    }, [nodesWithState, edges])

    return (
        <div className="tw-flex tw-h-screen tw-w-full tw-border-2 tw-border-solid tw-border-[var(--vscode-panel-border)] tw-text-[14px] tw-overflow-hidden">
            <div
                style={{ width: sidebarWidth + 'px' }}
                className="tw-flex-shrink-0 tw-border-r tw-border-solid tw-border-[var(--vscode-panel-border)] tw-bg-[var(--vscode-sideBar-background)] tw-overflow-y-auto tw-h-full"
            >
                <WorkflowSidebar
                    onNodeAdd={onNodeAdd}
                    selectedNode={activeNode} // Pass the single active node to sidebar
                    onNodeUpdate={onNodeUpdate}
                    onSave={onSave}
                    onLoad={onLoad}
                    onExecute={onExecute}
                    onClear={resetExecutionState}
                    isExecuting={isExecuting}
                    onAbort={onAbort}
                    models={models}
                    onSaveCustomNode={onSaveCustomNode}
                    onDeleteCustomNode={onDeleteCustomNode}
                    onRenameCustomNode={onRenameCustomNode}
                    customNodes={customNodes}
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
                            edges={orderedEdges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onEdgesDelete={onEdgesDelete}
                            onConnect={onConnect}
                            onNodeClick={onNodeClick}
                            onNodeDragStart={onNodeDragStart}
                            deleteKeyCode={['Backspace', 'Delete']}
                            nodeTypes={nodeTypes}
                            selectionMode={SelectionMode.Partial}
                            selectionOnDrag={true}
                            selectionKeyCode="Shift"
                            edgeTypes={{
                                'ordered-edge': props => (
                                    <CustomOrderedEdgeComponent {...props} edges={orderedEdges} />
                                ),
                            }}
                            fitView
                        >
                            <Background color="transparent" />
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
                            interruptedNodeId={interruptedNodeId}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
