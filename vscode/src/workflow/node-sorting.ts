import type { LoopStartNode } from '@/workflow/components/nodes/LoopStart_Node'
import type { Edge } from '../../webviews/workflow/components/CustomOrderedEdge'
import { NodeType, type WorkflowNodes } from '../../webviews/workflow/components/nodes/Nodes'

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
    direction: 'source' | 'target'
): WorkflowNodes[] {
    const isSourceDirection = direction === 'source'
    return edges
        .filter(edge => (isSourceDirection ? edge.source === nodeId : edge.target === nodeId))
        .map(edge => nodes.find(node => node.id === (isSourceDirection ? edge.target : edge.source))!)
        .filter(Boolean) as WorkflowNodes[] // Ensure no undefined values and cast
}

/**
 * Helper function to get nodes connected by edges originating from a source node ID.
 *
 * @param sourceNodeId - The ID of the source node.
 * @param nodes - An array of all nodes.
 * @param edges - An array of all edges.
 * @returns An array of nodes connected by edges from the source node.
 */
function getNodesConnectedBySource(
    sourceNodeId: string,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[] {
    return getNodesConnectedByDirection(sourceNodeId, nodes, edges, 'source') // Refactored to use getNodesConnectedByDirection
}

/**
 * Helper function to get nodes connected by edges pointing to a target node ID.
 *
 * @param targetNodeId - The ID of the target node.
 * @param nodes - An array of all nodes.
 * @param edges - An array of all edges.
 * @returns An array of nodes connected by edges to the target node.
 */
function getNodesConnectedByTarget(
    targetNodeId: string,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[] {
    return getNodesConnectedByDirection(targetNodeId, nodes, edges, 'target') // Refactored to use getNodesConnectedByDirection
}

/**
 * Retrieves an array of root nodes from the given array of nodes and edges.
 *
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns An array of root nodes, which are the nodes that are not the target of any edge.
 */
export function findRootNodes(nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes[] {
    // Create a set of target node IDs
    const targetIds = new Set(edges.map(edge => edge.target))
    return nodes.filter(node => !targetIds.has(node.id))
}

/**
 * Retrieves the single root node from the given array of nodes and edges.
 *
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns The single root node, which is the node that is not the target of any edge.
 * @throws {Error} If there is not exactly one root node.
 */
export function findRootNode(nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes {
    const rootNodes = findRootNodes(nodes, edges)
    if (rootNodes.length !== 1) {
        throw new Error('There should be exactly one root node.')
    }
    return rootNodes[0]
}

/**
 * Detects a cycle in the graph by checking if the given node ID is already in the temporary set and not in the stack.
 *
 * @param nodeId - The ID of the node to check for a cycle.
 * @param temp - The temporary set of visited node IDs.
 * @param stack - The stack of nodes being visited, along with their state.
 * @throws {Error} If a cycle is detected in the graph.
 */
function detectCycle(
    nodeId: string,
    temp: Set<string>,
    stack: { node: WorkflowNodes; state: 'visiting' | 'visited' }[]
): void {
    if (temp.has(nodeId) && !stack.some(item => item.node.id === nodeId)) {
        throw new Error('Cycle detected')
    }
}

/**
 * Adds the child nodes of the given node to the stack, ensuring that cycles are detected and handled.
 *
 * @param node - The current node being processed.
 * @param temp - The temporary set of visited node IDs.
 * @param stack - The stack of nodes being visited, along with their state.
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns The updated stack with the child nodes added.
 */
function addChildrenToStack(
    node: WorkflowNodes,
    temp: Set<string>,
    stack: { node: WorkflowNodes; state: 'visiting' | 'visited' }[],
    nodes: WorkflowNodes[],
    edges: Edge[]
): { node: WorkflowNodes; state: 'visiting' | 'visited' }[] {
    const children = getNodesConnectedBySource(node.id, nodes, edges)
    for (const child of children) {
        if (!temp.has(child.id) && !stack.some(item => item.node.id === child.id)) {
            stack.push({ node: child, state: 'visiting' })
        } else {
            detectCycle(child.id, temp, stack)
        }
    }
    return stack
}

/**
 * Performs a depth-first search (DFS) visit on the given node, adding its children to the stack and updating the temporary set of visited nodes.
 *
 * @param node - The current node being processed.
 * @param temp - The temporary set of visited node IDs.
 * @param stack - The stack of nodes being visited, along with their state.
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns An object containing the updated temporary set and stack.
 */
function dfsVisit(
    node: WorkflowNodes,
    temp: Set<string>,
    stack: { node: WorkflowNodes; state: 'visiting' | 'visited' }[],
    nodes: WorkflowNodes[],
    edges: Edge[]
): {
    temp: Set<string>
    stack: { node: WorkflowNodes; state: 'visiting' | 'visited' }[]
} {
    temp.add(node.id)
    stack.push({ node: node, state: 'visited' })
    stack = addChildrenToStack(node, temp, stack, nodes, edges)
    return { temp, stack }
}

/**
 * Processes the current stack item during the depth-first search (DFS) traversal of the graph.
 *
 * @param currentStackItem - The current stack item being processed, containing the node and its state.
 * @param temp - The temporary set of visited node IDs.
 * @param stack - The stack of nodes being visited, along with their state.
 * @param visited - The set of visited node IDs.
 * @param sorted - The sorted list of nodes.
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns An object containing the updated temporary set, stack, visited set, and sorted list.
 */
function processStackItem(
    currentStackItem: { node: WorkflowNodes; state: 'visiting' | 'visited' },
    temp: Set<string>,
    stack: { node: WorkflowNodes; state: 'visiting' | 'visited' }[],
    visited: Set<string>,
    sorted: WorkflowNodes[],
    nodes: WorkflowNodes[],
    edges: Edge[]
) {
    const { node, state } = currentStackItem

    if (state === 'visiting') {
        const { temp: updatedTemp, stack: updatedStack } = dfsVisit(node, temp, stack, nodes, edges)
        return { temp: updatedTemp, stack: updatedStack, visited, sorted }
    }

    if (!visited.has(node.id)) {
        visited.add(node.id)
        sorted.push(node)
        temp.delete(node.id)
    }

    return { temp, stack, visited, sorted }
}

/**
 * Performs a depth-first search (DFS) traversal of the graph starting from the given root node, and returns the visited nodes and the sorted list of nodes.
 *
 * @param rootNode - The root node to start the DFS traversal from.
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns An object containing the set of visited node IDs and the sorted list of nodes.
 */
export function visitNode(
    rootNode: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[]
): { visited: Set<string>; sorted: WorkflowNodes[] } {
    const visited = new Set<string>()
    let sorted: WorkflowNodes[] = []
    let stack: { node: WorkflowNodes; state: 'visiting' | 'visited' }[] = [
        {
            node: rootNode,
            state: 'visiting',
        },
    ]
    let temp = new Set<string>()

    while (stack.length > 0) {
        const currentStackItem = stack.pop()
        const {
            temp: newTemp,
            stack: newStack,
            visited: newVisited,
            sorted: newSorted,
        } = processStackItem(currentStackItem!, temp, stack, visited, sorted, nodes, edges)
        temp = newTemp
        stack = newStack
        visited.clear()
        for (const id of newVisited) {
            visited.add(id)
        }
        sorted = newSorted
    }
    return { visited, sorted }
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
 * Performs a Tarjan sort on the provided nodes and edges, returning the sorted list of nodes.
 *
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns The sorted list of nodes.
 */
export function tarjanSort(nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes[] {
    const sorted: WorkflowNodes[] = []
    const visited = new Set<string>()
    const sortedSet = new Set<string>()

    let rootNodes = findRootNodes(nodes, edges)

    if (rootNodes.length === 0) {
        rootNodes = nodes
    }

    for (const rootNode of rootNodes) {
        const { visited: newVisited, sorted: newSorted } = visitNode(rootNode, nodes, edges)

        for (const id of newVisited) {
            visited.add(id)
        }
        for (const node of newSorted) {
            if (!sortedSet.has(node.id)) {
                sorted.push(node)
                sortedSet.add(node.id)
            }
        }
    }
    return sorted.reverse()
}

/**
 * Finds the nodes that are before the loop structure in the given graph.
 *
 * @param loopStart - The node representing the start of the loop.
 * @param nodes - An array of all nodes in the graph.
 * @param edges - An array of all edges in the graph.
 * @returns An array of nodes that are before the loop structure.
 */
export function findPreLoopNodes(
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
        const parentNodes = getNodesConnectedByTarget(node.id, nodes, edges) // Refactored to use helper function
        for (const parentNode of parentNodes) {
            explorePreLoopNodes(parentNode)
        }

        // Explore child nodes (siblings and their descendants)
        const childNodes = getNodesConnectedBySource(node.id, nodes, edges)
        for (const childNode of childNodes) {
            explorePreLoopNodes(childNode)
        }
    }

    // Get direct parent nodes of loopStart and start traversal from them
    const directParentsOfLoopStart = getNodesConnectedByTarget(loopStart.id, nodes, edges) // Refactored to use helper function
    for (const parentNode of directParentsOfLoopStart) {
        explorePreLoopNodes(parentNode)
    }

    const preLoopNodeArray = [...preLoopNodes]

    // Filter edges to only include pre-loop nodes
    const preLoopEdges = filterEdgesForNodeSet(edges, new Set(preLoopNodeArray.map(n => n.id))) // Refactored to use filterEdgesForNodeSet

    return tarjanSort(preLoopNodeArray, preLoopEdges)
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
export function findLoopNodes(
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
        const childNodes = getNodesConnectedBySource(currentNode.id, nodes, edges) // Refactored to use helper function
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
        const parentNodes = getNodesConnectedByTarget(currentNode.id, nodes, edges) // Refactored to use helper function
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
    const loopEdges = filterEdgesForNodeSet(edges, loopNodeIds) // Refactored to use filterEdgesForNodeSet

    return tarjanSort([...loopNodes], loopEdges)
}

/**
 * Finds the nodes that are after the loop structure in the given graph.
 *
 * @param loopEnd - The node representing the end of the loop.
 * @param nodes - An array of all nodes in the graph.
 * @param edges - An array of all edges in the graph.
 * @returns An array of nodes that are after the loop structure.
 */
export function findPostLoopNodes(
    loopEnd: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[] {
    const postLoopNodes = new Set<WorkflowNodes>()
    const postLoopQueue = [loopEnd]

    while (postLoopQueue.length > 0) {
        const currentNode = postLoopQueue.pop()!
        const childNodes = getNodesConnectedBySource(currentNode.id, nodes, edges) // Refactored to use helper function
        const parentNodes = getNodesConnectedByTarget(currentNode.id, nodes, edges) // Refactored to use helper function

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
    const postLoopEdges = filterEdgesForNodeSet(edges, postLoopNodeIds) // Refactored to use filterEdgesForNodeSet

    return tarjanSort([...postLoopNodes], postLoopEdges)
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
    const subgraphComponents = findStronglyConnectedComponents(activeNodes, activeEdges)
    const loopStartNodes = activeNodes.filter(node => node.type === NodeType.LOOP_START)

    if (loopStartNodes.length === 0) {
        return subgraphComponents
            .flatMap(component =>
                tarjanSort(
                    component,
                    activeEdges.filter(
                        edge =>
                            component.some(n => n.id === edge.source) &&
                            component.some(n => n.id === edge.target)
                    )
                )
            )
            .reverse()
    }

    // Currently handling Loop compositions
    if (loopStartNodes.some(n => n.type === NodeType.LOOP_START)) {
        return processLoopWithCycles(activeNodes, activeEdges, shouldIterateLoops)
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
export function findStronglyConnectedComponents(
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes[][] {
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
        const children = getNodesConnectedBySource(node.id, nodes, edges).filter(
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
export function findRelatedNodeOfType(
    startNode: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[],
    targetNodeType: NodeType,
    traversalDirection: 'source' | 'target',
    avoidNodeType?: NodeType
): WorkflowNodes | undefined {
    const visited = new Set<string>()
    const stack: WorkflowNodes[] = [startNode]
    const getConnectionNodes =
        traversalDirection === 'source' ? getNodesConnectedBySource : getNodesConnectedByTarget // Dynamically select direction

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
 * Finds the loop start node for the given loop end node in the workflow graph.
 *
 * @param loopEnd - The loop end node to find the corresponding loop start for.
 * @param nodes - The array of workflow nodes.
 * @param edges - The array of edges between the workflow nodes.
 * @returns The loop start node if found, otherwise `undefined`.
 */
export function findLoopStartForLoopEnd(
    loopEnd: WorkflowNodes,
    nodes: WorkflowNodes[],
    edges: Edge[]
): WorkflowNodes | undefined {
    return findRelatedNodeOfType(loopEnd, nodes, edges, NodeType.LOOP_START, 'target', NodeType.LOOP_END) // Refactored to use findRelatedNodeOfType
}

/**
 * Finds the loop end node for the given loop start node in the workflow graph.
 *
 * @param loopStart - The loop start node to find the corresponding loop end for.
 * @param nodes - The array of workflow nodes.
 * @param edges - The array of edges between the workflow nodes.
 * @returns The loop end node if found, otherwise `undefined`.
 */
export function findLoopEndForLoopStart(
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
export function processLoopWithCycles(
    nodes: WorkflowNodes[],
    edges: Edge[],
    shouldIterateLoops = true
): WorkflowNodes[] {
    const processedNodes: WorkflowNodes[] = []
    const loopStartNodes = nodes.filter(n => n.type === NodeType.LOOP_START)

    for (const loopStart of loopStartNodes) {
        const loopEnd = findLoopEndForLoopStart(loopStart, nodes, edges)

        // Process pre-loop nodes
        const preLoopNodes = findPreLoopNodes(loopStart, nodes, edges)
        for (const node of preLoopNodes) {
            if (!processedNodes.some(processedNode => processedNode.id === node.id)) {
                processedNodes.push({ ...node })
            }
        }

        // Find post-loop nodes first to exclude them from loop processing
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

/**
 * Orders the nodes in a component based on their dependencies.
 *
 * @param component - The component of workflow nodes to be ordered.
 * @param startNode - The starting node for the ordering.
 * @param edges - The edges between the workflow nodes.
 * @returns The ordered list of workflow nodes.
 */
export function orderComponentNodes(
    component: WorkflowNodes[],
    startNode: WorkflowNodes,
    edges: Edge[]
): WorkflowNodes[] {
    const ordered = [startNode]
    const remaining = component.filter(n => n.id !== startNode.id)

    while (remaining.length > 0) {
        const current = ordered[ordered.length - 1]
        const next =
            remaining.find(n => edges.some(e => e.source === current.id && e.target === n.id)) ||
            remaining[0] // Guaranteed fallback

        ordered.push(next)
        remaining.splice(remaining.indexOf(next), 1)
    }

    return ordered
}

/**
 * Orders the components of workflow nodes based on their dependencies.
 *
 * @param components - The array of workflow node components to be ordered.
 * @param edges - The edges between the workflow nodes.
 * @returns The ordered array of workflow node components.
 */
export function sortComponentsByDependencies(
    components: WorkflowNodes[][],
    edges: Edge[]
): WorkflowNodes[][] {
    return components.sort((compA, compB) => {
        const hasEdgeFromAtoB = edges.some(
            e => compA.some(a => e.source === a.id) && compB.some(b => e.target === b.id)
        )
        const hasEdgeFromBtoA = edges.some(
            e => compB.some(b => e.source === b.id) && compA.some(a => e.target === a.id)
        )

        if (hasEdgeFromAtoB) return -1
        if (hasEdgeFromBtoA) return 1
        return 0
    })
}
