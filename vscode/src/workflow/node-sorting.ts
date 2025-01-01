/**
 * STRICT REQUIREMENTS:
 *
 * The node graph is part of a graph processing algorithm that uses a list of unsorted nodes
 * and a list of unsorted edges. The algorithm sorts the nodes based solely on the edges.
 * The sorted nodes are then returned.
 *
 * If a child node has many parents, those parents needs to be processed before the child node,
 * because the child node needs all output from the parents before it can be processed.
 *
 * If there is a loop in the graph marked with a LoopStart and LoopEnd node type, then the loop needs to be processed first.
 * If the loop start has one or many parents, then the parents needs to be processed before the loop start,
 * if the loop end has one or many children, then the loop end needs to be processed before the children.
 *
 * The algorithm uses a Tarjan's algorithm.
 *
 * We identify Loop graphs, pre-Loop graphs and post-Loop graphs as distinct "Graph DNA"
 */

import type { Edge } from '../../webviews/workflow/components/CustomOrderedEdge'
import {
    type LoopStartNode,
    NodeType,
    type WorkflowNodes,
} from '../../webviews/workflow/components/nodes/Nodes'

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
 * Retrieves the child nodes of a given node in a graph.
 *
 * @param nodeId - The ID of the node for which to retrieve the child nodes.
 * @param nodes - An array of all the nodes in the graph.
 * @param edges - An array of all the edges in the graph.
 * @returns An array of child nodes, sorted by their target ID in ascending order and then reversed.
 */
export function getChildNodes(nodeId: string, nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes[] {
    return edges.filter(e => e.source === nodeId).map(e => nodes.find(n => n.id === e.target)!)
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
    const children = getChildNodes(node.id, nodes, edges)
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

    const rootNodes = findRootNodes(nodes, edges).reverse()

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
    const preLoopQueue = [loopStart]

    while (preLoopQueue.length > 0) {
        const currentNode = preLoopQueue.pop()!
        const parentEdges = edges.filter(e => e.target === currentNode.id)

        for (const edge of parentEdges) {
            const parentNode = nodes.find(n => n.id === edge.source)
            if (
                parentNode &&
                parentNode.type !== NodeType.LOOP_START &&
                !preLoopNodes.has(parentNode) &&
                parentNode.type !== NodeType.LOOP_END
            ) {
                preLoopNodes.add(parentNode)
                preLoopQueue.push(parentNode)
            }
        }
    }

    const preLoopEdges = edges.filter(
        e =>
            [...preLoopNodes].some(n => n.id === e.source) &&
            [...preLoopNodes].some(n => n.id === e.target)
    )

    return tarjanSort([...preLoopNodes], preLoopEdges)
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
        const childEdges = edges.filter(e => e.source === currentNode.id)
        for (const edge of childEdges) {
            const childNode = nodes.find(n => n.id === edge.target)
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
        const parentEdges = edges.filter(e => e.target === currentNode.id)
        for (const edge of parentEdges) {
            const parentNode = nodes.find(n => n.id === edge.source)
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

    const loopEdges = edges.filter(
        e => [...loopNodes].some(n => n.id === e.source) && [...loopNodes].some(n => n.id === e.target)
    )

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
        const childEdges = edges.filter(e => e.source === currentNode.id)

        for (const edge of childEdges) {
            const childNode = nodes.find(n => n.id === edge.target)
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
    }

    const postLoopEdges = edges.filter(
        e =>
            [...postLoopNodes].some(n => n.id === e.source) &&
            [...postLoopNodes].some(n => n.id === e.target)
    )

    return tarjanSort([...postLoopNodes], postLoopEdges)
}

/**
 * Processes the loop iterations for a given loop structure, creating a list of processed nodes that includes the loop start, loop body, and loop end (if present).
 *
 * @param loopStart - The node representing the start of the loop.
 * @param loopEnd - The node representing the end of the loop, or undefined if no loop end is present.
 * @param loopBody - An array of nodes representing the body of the loop.
 * @returns An array of processed nodes, including the loop start, loop body, and loop end (if present).
 */
export function processLoopIterations(
    loopStart: WorkflowNodes,
    loopEnd: WorkflowNodes | undefined,
    loopBody: WorkflowNodes[]
): WorkflowNodes[] {
    const processedNodes: WorkflowNodes[] = []
    const iterations = (loopStart as LoopStartNode).data.iterations || 1

    for (let i = 0; i < iterations; i++) {
        processedNodes.push({ ...loopStart })
        for (const node of loopBody) {
            processedNodes.push({ ...node })
        }
        if (loopEnd) {
            processedNodes.push({ ...loopEnd })
        }
    }

    return processedNodes
}

/**
 * Processes the loop structure in the given graph, handling the pre-loop nodes, loop nodes, and post-loop nodes.
 *
 * @param nodes - An array of nodes in the graph.
 * @param edges - An array of edges in the graph.
 * @returns An array of processed nodes, including the loop start, loop body, and loop end (if present).
 */
export function processLoop(nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes[] {
    const processedNodes: WorkflowNodes[] = []
    const loopStartNodes = nodes.filter(n => n.type === NodeType.LOOP_START)

    for (const loopStart of loopStartNodes) {
        const loopEnd = nodes.find(n => n.type === NodeType.LOOP_END)

        // Process pre-loop nodes
        const sortedPreLoop = findPreLoopNodes(loopStart, nodes, edges)
        const preLoopNodeIds = new Set(sortedPreLoop.map(n => n.id))
        for (const node of sortedPreLoop) {
            processedNodes.push({ ...node })
        }
        // Process loop nodes
        const sortedLoop = findLoopNodes(loopStart, nodes, edges, preLoopNodeIds)

        // Process iterations
        const iterationNodes = processLoopIterations(loopStart, loopEnd, sortedLoop)
        processedNodes.push(...iterationNodes)

        // Process post-loop nodes if loopEnd exists
        if (loopEnd) {
            const sortedPostLoop = findPostLoopNodes(loopEnd, nodes, edges)
            for (const node of sortedPostLoop) {
                processedNodes.push({ ...node })
            }
        }
    }

    return processedNodes
}

/**
 * Processes the composition of a graph, handling different types of composition nodes (e.g. loops, conditionals).
 *
 * @param nodes - An array of nodes in the graph.
 * @param edges - An array of edges in the graph.
 * @returns An array of processed nodes, with the composition nodes handled appropriately.
 */
export function processGraphComposition(nodes: WorkflowNodes[], edges: Edge[]): WorkflowNodes[] {
    // Find all composition nodes (LoopStart, IfStart, etc.)
    const components = findStronglyConnectedComponents(nodes, edges)
    const compositionNodes = nodes.filter(node => node.type === NodeType.LOOP_START)

    if (compositionNodes.length === 0) {
        const flatComponents = components.flat()
        const componentIds = new Set(flatComponents.map(n => n.id))

        const filteredEdges = edges.filter(
            edge => componentIds.has(edge.source) && componentIds.has(edge.target)
        )

        return tarjanSort(flatComponents, filteredEdges)
    }

    // Currently handling Loop compositions
    if (compositionNodes.some(n => n.type === NodeType.LOOP_START)) {
        return processLoopWithCycles(nodes, edges, components)
    }

    return nodes
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
        const children = getChildNodes(node.id, nodes, edges).filter(
            n => (n.type !== NodeType.LOOP_START && n.type !== NodeType.LOOP_END) || n.id === node.id
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
    components: WorkflowNodes[][]
): WorkflowNodes[] {
    const processedNodes: WorkflowNodes[] = []
    const loopStartNodes = nodes.filter(n => n.type === NodeType.LOOP_START)

    for (const loopStart of loopStartNodes) {
        const loopEnd = nodes.find(n => n.type === NodeType.LOOP_END)
        const entryNodeId = edges.find(e => e.source === loopStart.id)?.target

        const processedComponents = components
            .filter(comp => comp.every(n => !CONTROL_FLOW_NODES.has(n.type)))
            .map(component => {
                if (component.length === 1) return component

                const componentEntryNode =
                    component.find(n => n.id === entryNodeId) ||
                    component.find(n =>
                        edges.some(e => e.source === n.id && component.some(cn => cn.id === e.target))
                    ) ||
                    component[0] // Guaranteed fallback

                return orderComponentNodes(component, componentEntryNode, edges)
            })

        const sortedComponents = sortComponentsByDependencies(processedComponents, edges)
        const flattenedNodes = sortedComponents.flat()

        const iterations = (loopStart as LoopStartNode).data.iterations || 1

        for (let i = 0; i < iterations; i++) {
            processedNodes.push({ ...loopStart })
            for (const node of flattenedNodes) {
                processedNodes.push({ ...node })
            }
            if (loopEnd) {
                processedNodes.push({ ...loopEnd })
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
