import type { LoopStartNode } from '@/workflow/components/nodes/LoopStart_Node'
import type { Edge } from '../../webviews/workflow/components/CustomOrderedEdge'
import { NodeType, type WorkflowNodes } from '../../webviews/workflow/components/nodes/Nodes'

interface IndexedOrder {
    bySourceTarget: Map<string, number>
    byTarget: Map<string, Edge[]>
}

/**
 * Helper function to get nodes connected by edges based on the specified direction.
 *
 * @param nodeId - The ID of the node.
 * @param nodes - An array of all nodes.
 * @param edges - An array of all edges.
 * @param direction - 'source' to get nodes connected by edges originating from nodeId, or 'target' for edges pointing to nodeId.
 * @returns An array of nodes connected by edges in the specified direction.
 */
function getNodesConnectedByDirection(
    nodeId: string,
    nodes: WorkflowNodes[],
    edges: Edge[],
    direction: 'child' | 'parent'
): WorkflowNodes[] {
    const isSourceDirection = direction === 'child'
    return edges
        .filter(edge => (isSourceDirection ? edge.source === nodeId : edge.target === nodeId))
        .map(edge => nodes.find(node => node.id === (isSourceDirection ? edge.target : edge.source))!)
        .filter(Boolean) as WorkflowNodes[] // Ensure no undefined values and cast
}

/**
 * Helper function to get nodes connected by edges originating from a child node ID.
 *
 * @param sourceNodeId - The ID of the child node.
 * @param nodes - An array of all nodes.
 * @param edges - An array of all edges.
 * @returns An array of nodes connected by edges from the child node.
 */
function getChildNodesFrom(
    sourceNodeId: string,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[] {
    return getNodesConnectedByDirection(sourceNodeId, nodes, edges, 'child')
}

/**
 * Helper function to get nodes connected by edges pointing to a parent node ID.
 *
 * @param targetNodeId - The ID of the parent node.
 * @param nodes - An array of all nodes.
 * @param edges - An array of all edges.
 * @returns An array of nodes connected by edges to the parent node.
 */
function getParentNodesFrom(
    targetNodeId: string,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[] {
    return getNodesConnectedByDirection(targetNodeId, nodes, edges, 'parent')
}

/**
 * Filters edges to only include those where both source and target nodes are in the provided node IDs set.
 *
 * @param edges - An array of edges to filter.
 * @param nodeIds - A set of node IDs to filter edges by.
 * @returns An array of edges that are connected to nodes within the nodeIds set.
 */
function filterEdgesForNodeSet(edges: Edge[], nodeIds: Set<string>): Edge[] {
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
}

/**
 * Calculates the priority of a given node based on the minimum order of its outgoing edges.
 *
 * @param node - The workflow node to calculate the priority for.
 * @param edgeIndex - An object containing indexed information about the edges.
 * @param activeEdges - The set of active edges in the workflow.
 * @returns The minimum order of the node's outgoing edges, or `Number.POSITIVE_INFINITY` if the node has no outgoing edges.
 */
const getNodePriority = (node: WorkflowNodes, edgeIndex: IndexedOrder, activeEdges: Edge[]): number => {
    let minOrder = Number.POSITIVE_INFINITY
    for (const edge of activeEdges) {
        if (edge.source === node.id) {
            const key = `${edge.source}-${edge.target}`
            const order = edgeIndex.bySourceTarget.get(key) || Number.POSITIVE_INFINITY
            minOrder = Math.min(minOrder, order)
        }
    }
    return minOrder
}

/**
 * Performs a topological sort of the given active nodes and edges, taking into account the order of the edges.
 *
 * @param activeNodes - An array of active workflow nodes.
 * @param activeEdges - An array of active edges in the workflow.
 * @returns An array of workflow nodes in the sorted order.
 */
function kahnSortbyOrderedEdges(activeNodes: WorkflowNodes[], activeEdges: Edge[]): WorkflowNodes[] {
    // 1. Calculate edgeIndex
    const edgeIndex: IndexedOrder = (() => {
        const bySourceTarget = new Map<string, number>()
        const byTarget = new Map<string, Edge[]>()

        if (!activeEdges) return { bySourceTarget, byTarget }

        // Index edges by target for quick parent edge lookups
        for (const edge of activeEdges) {
            const targetEdges = byTarget.get(edge.target) || []
            targetEdges.push(edge)
            byTarget.set(edge.target, targetEdges)
        }

        // Precompute order numbers
        for (const [targetId, targetEdges] of byTarget) {
            targetEdges.forEach((edge, index) => {
                const key = `${edge.source}-${targetId}`
                bySourceTarget.set(key, index + 1)
            })
        }

        return { bySourceTarget, byTarget }
    })()

    // 2. Calculate In-Degrees
    const inDegree = new Map<string, number>()
    const processedNodes = new Set<string>()

    for (const node of activeNodes) {
        inDegree.set(node.id, 0) // Initialize in-degree for all active nodes to 0
    }
    for (const edge of activeEdges) {
        const currentDegree = inDegree.get(edge.target) || 0 // Default to 0 if target not in activeNodes (shouldn't happen with activeEdges filter, but for safety)
        inDegree.set(edge.target, currentDegree + 1)
    }
    // 3. Initialize Queue with Zero In-Degree Nodes
    const queue: WorkflowNodes[] = activeNodes.filter(node => inDegree.get(node.id) === 0)
    // Sort initial queue based on priority
    queue.sort(
        (a, b) => getNodePriority(a, edgeIndex, activeEdges) - getNodePriority(b, edgeIndex, activeEdges)
    )

    // 4. Process Queue and Build Sorted List
    const sortedNodes: WorkflowNodes[] = []

    while (sortedNodes.length < activeNodes.length) {
        if (queue.length === 0) {
            // Find node with minimum in-degree that hasn't been processed
            const remainingNodes = activeNodes.filter(node => !processedNodes.has(node.id))
            const minDegreeNode = remainingNodes.reduce((min, node) => {
                const degree = inDegree.get(node.id) || 0
                const minDegree = inDegree.get(min.id) || 0
                return degree < minDegree ? node : min
            }, remainingNodes[0])

            if (minDegreeNode) {
                queue.push(minDegreeNode)
            }
        }

        const currentNode = queue.shift()!
        processedNodes.add(currentNode.id)
        sortedNodes.push(currentNode)

        // Process neighbors
        for (const edge of activeEdges) {
            if (edge.source === currentNode.id) {
                const targetNode = activeNodes.find(node => node.id === edge.target)
                if (targetNode && !processedNodes.has(targetNode.id)) {
                    const newDegree = (inDegree.get(targetNode.id) || 0) - 1
                    inDegree.set(targetNode.id, newDegree)
                    if (newDegree === 0) {
                        queue.push(targetNode)
                    }
                }
            }
        }

        queue.sort(
            (a, b) =>
                getNodePriority(a, edgeIndex, activeEdges) - getNodePriority(b, edgeIndex, activeEdges)
        )
    }
    return sortedNodes
}

/**
 * Finds the nodes that are before the loop structure in the given graph.
 *
 * @param loopStart - The node representing the start of the loop.
 * @param nodes - An array of all nodes in the graph.
 * @param edges - An array of all edges in the graph.
 * @returns An array of nodes that are before the loop structure.
 */
function findPreLoopNodes(
    loopStart: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[] {
    const preLoopNodes = new Set<WorkflowNodes>()

    // Recursive helper function to explore pre-loop nodes
    function explorePreLoopNodes(node: WorkflowNodes): void {
        if (
            node.type === NodeType.LOOP_START ||
            node.type === NodeType.LOOP_END ||
            preLoopNodes.has(node)
        ) {
            return // Base cases: stop recursion
        }
        preLoopNodes.add(node)

        // Explore parent nodes
        const parentNodes = getParentNodesFrom(node.id, nodes, edges)
        for (const parentNode of parentNodes) {
            explorePreLoopNodes(parentNode)
        }

        // Explore child nodes (siblings and their descendants)
        const childNodes = getChildNodesFrom(node.id, nodes, edges)
        for (const childNode of childNodes) {
            explorePreLoopNodes(childNode)
        }
    }

    // Get direct parent nodes of loopStart and start traversal from them
    const directParentsOfLoopStart = getParentNodesFrom(loopStart.id, nodes, edges)
    for (const parentNode of directParentsOfLoopStart) {
        explorePreLoopNodes(parentNode)
    }

    const preLoopNodeArray = [...preLoopNodes]

    // Filter edges to only include pre-loop nodes
    const preLoopEdges = filterEdgesForNodeSet(edges, new Set(preLoopNodeArray.map(n => n.id))) // Refactored to use filterEdgesForNodeSet

    return kahnSortbyOrderedEdges(preLoopNodeArray, preLoopEdges)
}

/**
 * Finds the nodes that are part of a loop structure in the given graph.
 *
 * @param loopStart - The node representing the start of the loop.
 * @param nodes - An array of all nodes in the graph.
 * @param edges - An array of all edges in the graph.
 * @param preLoopNodes - A set of node IDs that represent nodes that are before the loop structure.
 * @returns An array of nodes that are part of the loop structure.
 */
function findLoopNodes(
    loopStart: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[],
    preLoopNodes: Set<string>
): WorkflowNodes[] {
    const loopNodes = new Set<WorkflowNodes>()
    const loopQueue = [loopStart]

    while (loopQueue.length > 0) {
        const currentNode = loopQueue.pop()!

        // Check child relationships
        const childNodes = getChildNodesFrom(currentNode.id, nodes, edges)
        for (const childNode of childNodes) {
            if (
                childNode &&
                childNode.type !== NodeType.LOOP_END &&
                !loopNodes.has(childNode) &&
                !preLoopNodes.has(childNode.id)
            ) {
                loopNodes.add(childNode)
                loopQueue.push(childNode)
            }
        }

        // Check parent relationships within the loop structure
        const parentNodes = getParentNodesFrom(currentNode.id, nodes, edges)
        for (const parentNode of parentNodes) {
            if (
                parentNode &&
                parentNode.type !== NodeType.LOOP_START &&
                !loopNodes.has(parentNode) &&
                !preLoopNodes.has(parentNode.id)
            ) {
                loopNodes.add(parentNode)
                loopQueue.push(parentNode)
            }
        }
    }

    const loopNodeIds = new Set([...loopNodes].map(n => n.id))
    const loopEdges = filterEdgesForNodeSet(edges, loopNodeIds)
    const kahnSortedLoopNodes = kahnSortbyOrderedEdges([...loopNodes], loopEdges)
    return kahnSortedLoopNodes
}

/**
 * Finds the nodes that are after the loop structure in the given graph.
 *
 * @param loopEnd - The node representing the end of the loop.
 * @param nodes - An array of all nodes in the graph.
 * @param edges - An array of all edges in the graph.
 * @returns An array of nodes that are after the loop structure.
 */
function findPostLoopNodes(
    loopEnd: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[] {
    const postLoopNodes = new Set<WorkflowNodes>()
    const postLoopQueue = [loopEnd]

    while (postLoopQueue.length > 0) {
        const currentNode = postLoopQueue.pop()!
        const childNodes = getChildNodesFrom(currentNode.id, nodes, edges)
        const parentNodes = getParentNodesFrom(currentNode.id, nodes, edges)

        for (const childNode of childNodes) {
            if (
                childNode &&
                childNode.type !== NodeType.LOOP_END &&
                !postLoopNodes.has(childNode) &&
                childNode.type !== NodeType.LOOP_START
            ) {
                postLoopNodes.add(childNode)
                postLoopQueue.push(childNode)
            }
        }
        for (const parentNode of parentNodes) {
            if (
                parentNode &&
                parentNode.type !== NodeType.LOOP_END &&
                !postLoopNodes.has(parentNode) &&
                parentNode.type !== NodeType.LOOP_START
            ) {
                postLoopNodes.add(parentNode)
                postLoopQueue.push(parentNode)
            }
        }
    }

    const postLoopNodeIds = new Set([...postLoopNodes].map(n => n.id))
    const postLoopEdges = filterEdgesForNodeSet(edges, postLoopNodeIds)

    return kahnSortbyOrderedEdges([...postLoopNodes], postLoopEdges)
}

/**
 * Processes the composition of a graph, handling different types of composition nodes (e.g. loops, conditionals).
 *
 * @param nodes - An array of nodes in the graph.
 * @param edges - An array of edges in the graph.
 * @returns An array of processed nodes, with the composition nodes handled appropriately.
 */
export function processGraphComposition(
    nodes: WorkflowNodes[],
    edges: Edge[],
    shouldIterateLoops = true
): WorkflowNodes[] {
    // Create deep copies of nodes first to preserve all states
    const processedNodes = nodes.map(node => ({
        ...node,
        data: { ...node.data },
    }))

    // Filter active nodes after creating copies
    const activeNodes = processedNodes.filter(node => node.data.active !== false)

    // Filter edges between active nodes
    const activeEdges = edges.filter(
        edge =>
            activeNodes.some(node => node.id === edge.source) &&
            activeNodes.some(node => node.id === edge.target)
    )

    const loopStartNodes = activeNodes.filter(node => node.type === NodeType.LOOP_START)

    // Currently handling Loop compositions
    if (loopStartNodes.some(n => n.type === NodeType.LOOP_START)) {
        return processLoopWithCycles(activeNodes, activeEdges, shouldIterateLoops)
    }
    if (loopStartNodes.length === 0) {
        const subgraphComponents = findStronglyConnectedComponents(activeNodes, activeEdges)
        const flatSubs = subgraphComponents.flatMap(components => components)
        return kahnSortbyOrderedEdges(flatSubs, activeEdges)
    }

    return activeNodes
}

interface NodeState {
    index: number
    lowLink: number
    onStack: boolean
}

function initializeNodeState(): NodeState {
    return {
        index: -1,
        lowLink: -1,
        onStack: false,
    }
}

/**
 * Finds the strongly connected components in a graph represented by the given nodes and edges.
 *
 * @param nodes - An array of nodes in the graph.
 * @param edges - An array of edges in the graph.
 * @returns An array of arrays, where each inner array represents a strongly connected component.
 */
function findStronglyConnectedComponents(nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes[][] {
    const nodeStates = new Map<string, NodeState>()
    const stack: WorkflowNodes[] = []
    const components: WorkflowNodes[][] = []
    let index = 0

    function strongConnect(node: WorkflowNodes) {
        const state = initializeNodeState()
        state.index = index
        state.lowLink = index
        index += 1
        stack.push(node)
        state.onStack = true
        nodeStates.set(node.id, state)

        // Get only Simple type nodes as children for cycle detection
        const children = getChildNodesFrom(node.id, nodes, edges).filter(
            node => !CONTROL_FLOW_NODES.has(node.type)
        )
        for (const child of children) {
            const childState = nodeStates.get(child.id)
            if (!childState) {
                strongConnect(child)
                const newChildState = nodeStates.get(child.id)!
                const currentState = nodeStates.get(node.id)!
                currentState.lowLink = Math.min(currentState.lowLink, newChildState.lowLink)
            } else if (childState.onStack) {
                const currentState = nodeStates.get(node.id)!
                currentState.lowLink = Math.min(currentState.lowLink, childState.index)
            }
        }

        const currentState = nodeStates.get(node.id)!
        if (currentState.lowLink === currentState.index) {
            const component: WorkflowNodes[] = []
            let w: WorkflowNodes
            do {
                w = stack.pop()!
                nodeStates.get(w.id)!.onStack = false
                component.push(w)
            } while (w.id !== node.id)

            // Only add components that contain Simple type nodes
            if (component.some(n => !(n.type === NodeType.LOOP_START || n.type === NodeType.LOOP_END))) {
                components.push(component)
            }
        }
    }

    for (const node of nodes) {
        if (!nodeStates.has(node.id)) {
            strongConnect(node)
        }
    }
    return components
}

/**
 * Finds the loop start node for the given loop end node in the workflow graph.
 *
 * @param loopEnd - The loop end node to find the corresponding loop start for.
 * @param nodes - The array of workflow nodes.
 * @param edges - The array of edges between the workflow nodes.
 * @returns The loop start node if found, otherwise `undefined`.
 */
function findRelatedNodeOfType(
    startNode: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[],
    targetNodeType: NodeType,
    traversalDirection: 'source' | 'target',
    avoidNodeType?: NodeType
): WorkflowNodes | undefined {
    const visited = new Set<string>()
    const stack: WorkflowNodes[] = [startNode]
    const getConnectionNodes = traversalDirection === 'source' ? getChildNodesFrom : getParentNodesFrom // Dynamically select direction

    while (stack.length > 0) {
        const currentNode = stack.pop()!

        if (visited.has(currentNode.id)) {
            continue
        }
        visited.add(currentNode.id)

        if (currentNode.type === targetNodeType) {
            return currentNode
        }

        if (avoidNodeType && currentNode.type === avoidNodeType && currentNode.id !== startNode.id) {
            continue
        }

        // Get parent nodes instead of child nodes
        const relatedNodes = getConnectionNodes(currentNode.id, nodes, edges)
        for (const relatedNode of relatedNodes) {
            if (!visited.has(relatedNode.id)) {
                stack.push(relatedNode)
            }
        }
    }

    return undefined
}

/**
 * Finds the loop end node for the given loop start node in the workflow graph.
 *
 * @param loopStart - The loop start node to find the corresponding loop end for.
 * @param nodes - The array of workflow nodes.
 * @param edges - The array of edges between the workflow nodes.
 * @returns The loop end node if found, otherwise `undefined`.
 */
function findLoopEndForLoopStart(
    loopStart: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes | undefined {
    return findRelatedNodeOfType(
        loopStart,
        nodes,
        edges,
        NodeType.LOOP_END,
        'source',
        NodeType.LOOP_START
    ) // Refactored to use findRelatedNodeOfType
}

const CONTROL_FLOW_NODES = new Set([NodeType.LOOP_START, NodeType.LOOP_END])

/**
 * Processes the workflow nodes with loops and cycles, returning an ordered list of processed nodes.
 *
 * @param nodes - The workflow nodes to process.
 * @param edges - The edges between the workflow nodes.
 * @param components - The components of the workflow graph.
 * @returns The processed workflow nodes.
 */
function processLoopWithCycles(
    nodes: WorkflowNodes[],
    edges: Edge[],
    shouldIterateLoops = true
): WorkflowNodes[] {
    const processedNodes: WorkflowNodes[] = []
    const loopStartNodes = nodes.filter(n => n.type === NodeType.LOOP_START)

    for (const loopStart of loopStartNodes) {
        // Process pre-loop nodes
        const preLoopNodes = findPreLoopNodes(loopStart, nodes, edges)
        for (const node of preLoopNodes) {
            if (!processedNodes.some(processedNode => processedNode.id === node.id)) {
                processedNodes.push(node)
            }
        }

        // Find post-loop nodes first to exclude them from loop processing
        const loopEnd = findLoopEndForLoopStart(loopStart, nodes, edges)
        const postLoopNodes = loopEnd ? findPostLoopNodes(loopEnd, nodes, edges) : []
        const preLoopNodeIds = new Set(preLoopNodes.map(node => node.id))
        const nodesInsideLoop = findLoopNodes(loopStart, nodes, edges, preLoopNodeIds)

        // Process loop iterations
        const iterations = shouldIterateLoops ? (loopStart as LoopStartNode).data.iterations : 1

        for (let i = 0; i < iterations; i++) {
            processedNodes.push({ ...loopStart })
            for (const node of nodesInsideLoop) {
                processedNodes.push({ ...node })
            }
            if (loopEnd) {
                processedNodes.push({ ...loopEnd })
            }
        }

        // Process post-loop nodes after all iterations
        if (postLoopNodes.length > 0) {
            for (const node of postLoopNodes) {
                if (!processedNodes.some(processedNode => processedNode.id === node.id)) {
                    processedNodes.push({ ...node })
                }
            }
        }
    }

    return processedNodes
}
