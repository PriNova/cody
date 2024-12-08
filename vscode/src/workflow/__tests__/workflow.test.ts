import { v4 as uuidv4 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import type { Edge } from '../../../webviews/workflow/components/CustomOrderedEdge'
import {
    NodeType,
    type WorkflowNode,
    createEdge,
    createNode,
} from '../../../webviews/workflow/components/nodes/Nodes'
import {
    type IndexedExecutionContext,
    combineParentOutputsByConnectionOrder,
    createEdgeIndex,
    executeWorkflow,
    replaceIndexedInputs,
    sanitizeForShell,
    topologicalSort,
} from '../workflow-executor'

import * as os from 'node:os'
import { PersistentShell } from '../../commands/context/shell'
import { executeCLINode } from '../workflow-executor'

describe('createEdgeIndex', () => {
    // Test fixtures
    const sampleEdges: Edge[] = [
        { id: 'edge1', source: 'nodeA', target: 'nodeB' },
        { id: 'edge2', source: 'nodeB', target: 'nodeC' },
        { id: 'edge3', source: 'nodeA', target: 'nodeC' },
    ]

    it('creates correct indices for multiple edges', () => {
        const result = createEdgeIndex(sampleEdges)

        // Test bySource mapping
        expect(result.bySource.get('nodeA')?.length).toBe(2)
        expect(result.bySource.get('nodeB')?.length).toBe(1)
        expect(result.bySource.get('nodeC')).toBeUndefined()

        // Test byTarget mapping
        expect(result.byTarget.get('nodeB')?.length).toBe(1)
        expect(result.byTarget.get('nodeC')?.length).toBe(2)
        expect(result.byTarget.get('nodeA')).toBeUndefined()

        // Test byId mapping
        expect(result.byId.get('edge1')).toEqual(sampleEdges[0])
        expect(result.byId.get('edge2')).toEqual(sampleEdges[1])
        expect(result.byId.get('edge3')).toEqual(sampleEdges[2])
    })

    it('handles empty edge array', () => {
        const result = createEdgeIndex([])

        expect(result.bySource.size).toBe(0)
        expect(result.byTarget.size).toBe(0)
        expect(result.byId.size).toBe(0)
    })

    it('handles single edge', () => {
        const singleEdge: Edge = { id: 'edge1', source: 'nodeA', target: 'nodeB' }
        const result = createEdgeIndex([singleEdge])

        expect(result.bySource.get('nodeA')?.length).toBe(1)
        expect(result.byTarget.get('nodeB')?.length).toBe(1)
        expect(result.byId.get('edge1')).toEqual(singleEdge)
    })

    it('handles multiple edges with same source', () => {
        const multiSourceEdges: Edge[] = [
            { id: 'edge1', source: 'nodeA', target: 'nodeB' },
            { id: 'edge2', source: 'nodeA', target: 'nodeC' },
            { id: 'edge3', source: 'nodeA', target: 'nodeD' },
        ]
        const result = createEdgeIndex(multiSourceEdges)

        expect(result.bySource.get('nodeA')?.length).toBe(3)
        expect(result.bySource.size).toBe(1)
    })

    it('handles multiple edges with same target', () => {
        const multiTargetEdges: Edge[] = [
            { id: 'edge1', source: 'nodeA', target: 'nodeD' },
            { id: 'edge2', source: 'nodeB', target: 'nodeD' },
            { id: 'edge3', source: 'nodeC', target: 'nodeD' },
        ]
        const result = createEdgeIndex(multiTargetEdges)

        expect(result.byTarget.get('nodeD')?.length).toBe(3)
        expect(result.byTarget.size).toBe(1)
    })

    it('preserves edge reference integrity', () => {
        const edge: Edge = { id: 'edge1', source: 'nodeA', target: 'nodeB' }
        const result = createEdgeIndex([edge])

        const sourceEdge = result.bySource.get('nodeA')?.[0]
        const targetEdge = result.byTarget.get('nodeB')?.[0]
        const idEdge = result.byId.get('edge1')

        expect(sourceEdge).toBe(targetEdge)
        expect(sourceEdge).toBe(idEdge)
        expect(targetEdge).toBe(idEdge)
    })
})

describe('Topology Ordering', () => {
    test('workflow executes correctly with UUID node IDs', () => {
        const id1 = uuidv4()
        const id2 = uuidv4()

        const nodes: WorkflowNode[] = [
            {
                id: id1,
                type: 'cli' as NodeType,
                data: { title: 'CLI Node', content: 'echo "hello"' },
                position: { x: 0, y: 0 },
            },
            {
                id: id2,
                type: 'preview' as NodeType,
                data: { title: 'Preview Node', content: '' },
                position: { x: 0, y: 0 },
            },
        ]
        const edges = [{ id: uuidv4(), source: id1, target: id2 }]

        const sortedNodes = topologicalSort(nodes, edges)
        expect(sortedNodes[0].id).toBe(id1)
        expect(sortedNodes[1].id).toBe(id2)
    })

    test('topology sort maintains order with UUID nodes', () => {
        const id1 = uuidv4()
        const id2 = uuidv4()
        const id3 = uuidv4()

        const nodes: WorkflowNode[] = [
            {
                id: id1,
                type: 'cli' as NodeType,
                data: { title: 'First CLI', content: 'echo "hello"' },
                position: { x: 0, y: 0 },
            },
            {
                id: id2,
                type: 'llm' as NodeType,
                data: { title: 'LLM Node', content: 'echo "hello"' },
                position: { x: 0, y: 0 },
            },
            {
                id: id3,
                type: 'preview' as NodeType,
                data: { title: 'Preview', content: '' },
                position: { x: 0, y: 0 },
            },
        ]

        const edges = [
            { id: uuidv4(), source: id1, target: id2 },
            { id: uuidv4(), source: id2, target: id3 },
        ]

        const sortedNodes = topologicalSort(nodes, edges)
        expect(sortedNodes).toHaveLength(3)
        expect(sortedNodes[0].id).toBe(id1)
        expect(sortedNodes[1].id).toBe(id2)
        expect(sortedNodes[2].id).toBe(id3)
    })
})

describe('combineParentOutputsByConnectionOrder', () => {
    test('combines single parent output correctly', () => {
        const parentId = uuidv4()
        const childId = uuidv4()

        const context: IndexedExecutionContext = {
            nodeOutputs: new Map([[parentId, 'test output']]),
            nodeIndex: new Map(),
            edgeIndex: createEdgeIndex([{ id: uuidv4(), source: parentId, target: childId }]),
        }

        const result = combineParentOutputsByConnectionOrder(childId, context)
        expect(result).toEqual(['test output'])
    })

    test('preserves order of multiple parent outputs', () => {
        const parent1Id = uuidv4()
        const parent2Id = uuidv4()
        const childId = uuidv4()

        const context: IndexedExecutionContext = {
            nodeOutputs: new Map([
                [parent1Id, 'first output'],
                [parent2Id, 'second output'],
            ]),
            nodeIndex: new Map(),
            edgeIndex: createEdgeIndex([
                { id: uuidv4(), source: parent1Id, target: childId },
                { id: uuidv4(), source: parent2Id, target: childId },
            ]),
        }

        const result = combineParentOutputsByConnectionOrder(childId, context)
        expect(result).toEqual(['first output', 'second output'])
    })

    test('handles missing parent outputs', () => {
        const parent1Id = uuidv4()
        const parent2Id = uuidv4()
        const childId = uuidv4()

        const context: IndexedExecutionContext = {
            nodeOutputs: new Map([[parent1Id, 'existing output']]),
            nodeIndex: new Map(),
            edgeIndex: createEdgeIndex([
                { id: uuidv4(), source: parent1Id, target: childId },
                { id: uuidv4(), source: parent2Id, target: childId },
            ]),
        }

        const result = combineParentOutputsByConnectionOrder(childId, context)
        expect(result).toEqual(['existing output', ''])
    })

    test('normalizes different line endings', () => {
        const parentId = uuidv4()
        const childId = uuidv4()

        const context: IndexedExecutionContext = {
            nodeOutputs: new Map([[parentId, 'line1\r\nline2\r\nline3']]),
            nodeIndex: new Map(),
            edgeIndex: createEdgeIndex([{ id: uuidv4(), source: parentId, target: childId }]),
        }

        const result = combineParentOutputsByConnectionOrder(childId, context)
        expect(result).toEqual(['line1\nline2\nline3'])
    })

    test('handles node with no parents', () => {
        const childId = uuidv4()

        const context: IndexedExecutionContext = {
            nodeOutputs: new Map(),
            nodeIndex: new Map(),
            edgeIndex: createEdgeIndex([]),
        }

        const result = combineParentOutputsByConnectionOrder(childId, context)
        expect(result).toEqual([])
    })

    test('trims whitespace from outputs', () => {
        const parentId = uuidv4()
        const childId = uuidv4()

        const context: IndexedExecutionContext = {
            nodeOutputs: new Map([[parentId, '  output with spaces  \n  ']]),
            nodeIndex: new Map(),
            edgeIndex: createEdgeIndex([{ id: uuidv4(), source: parentId, target: childId }]),
        }

        const result = combineParentOutputsByConnectionOrder(childId, context)
        expect(result).toEqual(['output with spaces'])
    })
})

describe('sanitizeForShell', () => {
    it('handles empty string', () => {
        expect(sanitizeForShell('')).toBe('')
    })

    it('leaves normal text unmodified', () => {
        expect(sanitizeForShell('hello world')).toBe('hello world')
    })

    it('preserves quotes', () => {
        expect(sanitizeForShell('echo "hello"')).toBe('echo "hello"')
        expect(sanitizeForShell("echo 'value'")).toBe("echo 'value'")
    })

    it('escapes backslashes', () => {
        expect(sanitizeForShell('C:\\path\\to\\file')).toBe('C:\\\\path\\\\to\\\\file')
    })

    it('escapes template syntax', () => {
        expect(sanitizeForShell('echo ${var}')).toBe('echo \\${var}')
    })

    it('handles complex shell commands', () => {
        const input = 'echo "Path is: C:\\Program Files\\App" && echo ${HOME}'
        const expected = 'echo "Path is: C:\\\\Program Files\\\\App" && echo \\${HOME}'
        expect(sanitizeForShell(input)).toBe(expected)
    })

    it('preserves newlines', () => {
        const input = 'line1\nline2'
        expect(sanitizeForShell(input)).toBe(input)
    })
})

vi.mock('vscode', () => ({
    env: {
        shell: '/bin/bash',
    },
    workspace: {
        isTrusted: true,
        getConfiguration: (section: string) => ({
            get: (key: string) => {
                if (section === 'cody' && key === 'experimental.localTokenPath') {
                    return null
                }
                return undefined
            },
        }),
    },
    window: {
        showErrorMessage: vi.fn(),
        createOutputChannel: vi.fn().mockReturnValue({
            appendLine: vi.fn(),
            dispose: vi.fn(),
            show: vi.fn(),
        }),
    },
    extensions: {
        getExtension: vi.fn().mockReturnValue({
            packageJSON: { version: '1.0.0' },
        }),
    },
    Disposable: class {
        dispose(): void {}
    },
}))

describe('executeCLINode', () => {
    let shell: PersistentShell
    let abortController: AbortController
    const mockWebview = { postMessage: vi.fn() }
    const mockApprovalHandler = async (nodeId: string) => ''

    beforeEach(() => {
        shell = new PersistentShell()
        abortController = new AbortController()
    })

    afterEach(() => {
        shell.dispose()
    })

    // Safe command test cases
    it(
        'executes echo command successfully',
        async () => {
            const node = createNode({
                type: NodeType.CLI,
                data: {
                    title: 'Echo Test',
                    content: 'echo "hello world"',
                },
                position: { x: 0, y: 0 },
            })
            const result = await executeCLINode(node, abortController.signal, shell, mockWebview as any,
                mockApprovalHandler)
            expect(result.trim()).toBe('hello world')
        },
        { timeout: 10000 }
    )

    it('handles pwd command with home directory expansion', async () => {
        const node = createNode({
            type: NodeType.CLI,
            data: {
                title: 'PWD Test',
                content: 'pwd',
            },
            position: { x: 0, y: 0 },
        })

        const result = await executeCLINode(node, abortController.signal, shell, mockWebview as any,
            mockApprovalHandler)
        expect(result).toBeTruthy()
        expect(result.length).toBeGreaterThan(0)
    })

    // Path handling tests
    it('expands home directory correctly', async () => {
        const homeDir = os.homedir()
        const node = createNode({
            type: NodeType.CLI,
            data: {
                title: 'Home Dir Test',
                content: 'echo ~/test',
            },
            position: { x: 0, y: 0 },
        })

        const result = await executeCLINode(node, abortController.signal, shell, mockWebview as any,
            mockApprovalHandler)
        expect(result.trim()).toBe(`${homeDir}/test`)
    })

    // Security boundary tests
    it('rejects forbidden commands', async () => {
        const node = createNode({
            type: NodeType.CLI,
            data: {
                title: 'Forbidden Command',
                content: 'rm -rf /',
            },
            position: { x: 0, y: 0 },
        })

        await expect(executeCLINode(node, abortController.signal, shell, mockWebview as any,
            mockApprovalHandler)).rejects.toThrow(
            'Cody cannot execute this command'
        )
    })

    // Abort signal tests
    it('handles abort signal', async () => {
        const node = createNode({
            type: NodeType.CLI,
            data: {
                title: 'Long Running Command',
                content: 'sleep 5',
            },
            position: { x: 0, y: 0 },
        })

        const promise = executeCLINode(node, abortController.signal, shell, mockWebview as any,
            mockApprovalHandler)
        abortController.abort()

        await expect(promise).rejects.toThrow('Command execution aborted')
    })

    // Error handling tests
    it(
        'handles invalid commands',
        async () => {
            const node = createNode({
                type: NodeType.CLI,
                data: {
                    title: 'Invalid Command',
                    content: 'invalidcommand123',
                },
                position: { x: 0, y: 0 },
            })
            await expect(executeCLINode(node, abortController.signal, shell, mockWebview as any,
                mockApprovalHandler)).rejects.toThrow()
        },
        { timeout: 5000 }
    )

    // Empty command tests
    it('handles empty command', async () => {
        const node = createNode({
            type: NodeType.CLI,
            data: {
                title: 'Empty Command',
                content: '',
            },
            position: { x: 0, y: 0 },
        })

        await expect(executeCLINode(node, abortController.signal, shell, mockWebview as any,
            mockApprovalHandler)).rejects.toThrow()
    })

    // Command with special characters
    it(
        'executes multiple commands in sequence',
        async () => {
            const commands = ['echo "first"', 'echo "second"', 'echo "third"']

            for (const command of commands) {
                const node = createNode({
                    type: NodeType.CLI,
                    data: {
                        title: 'Sequential Test',
                        content: command,
                    },
                    position: { x: 0, y: 0 },
                })
                const result = await executeCLINode(node, abortController.signal, shell, mockWebview as any,
                    mockApprovalHandler)
                expect(result).toBeTruthy()
            }
        },
        { timeout: 5000 }
    )

    // Multiple command execution
    it(
        'executes multiple commands in sequence',
        async () => {
            const commands = ['echo "first"', 'echo "second"', 'echo "third"']

            for (const command of commands) {
                const node = createNode({
                    type: NodeType.CLI,
                    data: {
                        title: 'Sequential Test',
                        content: command,
                    },
                    position: { x: 0, y: 0 },
                })
                const result = await executeCLINode(node, abortController.signal, shell, mockWebview as any,
                    mockApprovalHandler)
                expect(result).toBeTruthy()
            }
        },
        { timeout: 10000 }
    )
})

describe('Workflow Executor Integration Tests', () => {
    const mockWebview = {
        postMessage: vi.fn(),
    }

    const mockChatClient = {
        chat: vi.fn(),
    }

    const mockContextRetriever = {
        retrieveContext: vi.fn(),
    }

    const mockAbortSignal = new AbortController().signal

    const mockApprovalHandler = async (nodeId: string) => ''

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it(
        'executes a workflow with safe CLI commands and text processing',
        async () => {
            const nodes: WorkflowNode[] = [
                createNode({
                    type: NodeType.CLI,
                    data: {
                        title: 'List Files',
                        content: 'ls -la',
                    },
                    position: { x: 0, y: 0 },
                }),
                createNode({
                    type: NodeType.INPUT,
                    data: {
                        title: 'Search Pattern',
                        content: '*.ts',
                    },
                    position: { x: 100, y: 0 },
                }),
                createNode({
                    type: NodeType.CLI,
                    data: {
                        title: 'Find Files',
                        content: 'find . -maxdepth 2 -name "${1}"',
                    },
                    position: { x: 200, y: 0 },
                }),
                createNode({
                    type: NodeType.PREVIEW,
                    data: {
                        title: 'Results',
                        content: '${2}',
                    },
                    position: { x: 300, y: 0 },
                }),
            ]

            const edges: Edge[] = [
                createEdge(nodes[0], nodes[2]),
                createEdge(nodes[1], nodes[2]),
                createEdge(nodes[2], nodes[3]),
            ]

            // Create proper edge indexing
            const bySource = new Map<string, Edge[]>()
            const byTarget = new Map<string, Edge[]>()
            const byId = new Map<string, Edge>()

            for (const edge of edges) {
                const sourceEdges = bySource.get(edge.source) || []
                sourceEdges.push(edge)
                bySource.set(edge.source, sourceEdges)

                const targetEdges = byTarget.get(edge.target) || []
                targetEdges.push(edge)
                byTarget.set(edge.target, targetEdges)

                byId.set(edge.id, edge)
            }
            const context = {
                nodeIndex: new Map(nodes.map(node => [node.id, node])),
                edgeIndex: { bySource, byTarget, byId },
                nodeOutputs: new Map([
                    [nodes[0].id, 'file1.ts\nfile2.ts'],
                    [nodes[1].id, '*.ts'],
                ]),
            }

            const combinedOutputs = combineParentOutputsByConnectionOrder(nodes[2].id, context)
            expect(combinedOutputs).toHaveLength(2)
            expect(combinedOutputs[0]).toBe('file1.ts\nfile2.ts')
            expect(combinedOutputs[1]).toBe('*.ts')

            // Execute workflow and verify status messages
            await executeWorkflow(
                nodes,
                edges,
                mockWebview as any,
                mockChatClient as any,
                mockAbortSignal,
                mockContextRetriever,
                mockApprovalHandler
            )
        },
        { timeout: 10000 }
    )

    it('handles special characters and escaping in CLI commands', () => {
        const nodes: WorkflowNode[] = [
            createNode({
                type: NodeType.INPUT,
                data: {
                    title: 'Branch Name',
                    content: 'branch/with${special}chars\\and spaces',
                },
                position: { x: 0, y: 0 },
            }),
            createNode({
                type: NodeType.CLI,
                data: {
                    title: 'Echio Command',
                    content: 'echo "${1}"',
                },
                position: { x: 100, y: 0 },
            }),
            createNode({
                type: NodeType.PREVIEW,
                data: {
                    title: 'Preview',
                    content: '${2}',
                },
                position: { x: 200, y: 0 },
            }),
        ]

        const edges: Edge[] = [createEdge(nodes[0], nodes[1]), createEdge(nodes[1], nodes[2])]

        const context = {
            nodeIndex: new Map(nodes.map(node => [node.id, node])),
            edgeIndex: {
                bySource: new Map(edges.map(edge => [edge.source, [edge]])),
                byTarget: new Map(edges.map(edge => [edge.target, [edge]])),
                byId: new Map(edges.map(edge => [edge.id, edge])),
            },
            nodeOutputs: new Map([[nodes[0].id, 'branch/with${special}chars\\and spaces']]),
        }

        const combinedOutputs = combineParentOutputsByConnectionOrder(nodes[1].id, context)
        const sanitizedOutput = sanitizeForShell(combinedOutputs[0])
        expect(sanitizedOutput).toBe('branch/with\\${special}chars\\\\and spaces')
    })

    it('handles complex template characters in multi-node workflow', () => {
        const nodes: WorkflowNode[] = [
            createNode({
                type: NodeType.INPUT,
                data: {
                    title: 'Template Input',
                    content: 'function sayHello() { return "Hello \'World\'!" }',
                },
                position: { x: 0, y: 0 },
            }),
            createNode({
                type: NodeType.CLI,
                data: {
                    title: 'Echo Complex String',
                    content: 'echo "${1}" > output.txt && cat output.txt',
                },
                position: { x: 100, y: 0 },
            }),
            createNode({
                type: NodeType.INPUT,
                data: {
                    title: 'Additional Parameters',
                    content: '--flag="custom value" \'single quoted value\'',
                },
                position: { x: 100, y: 100 },
            }),
            createNode({
                type: NodeType.CLI,
                data: {
                    title: 'Combined Echo',
                    content: 'echo ${1} ${2}',
                },
                position: { x: 200, y: 50 },
            }),
            createNode({
                type: NodeType.PREVIEW,
                data: {
                    title: 'Final Output',
                    content: '${3}',
                },
                position: { x: 300, y: 50 },
            }),
        ]

        const edges: Edge[] = [
            createEdge(nodes[0], nodes[1]),
            createEdge(nodes[0], nodes[3]),
            createEdge(nodes[2], nodes[3]),
            createEdge(nodes[3], nodes[4]),
        ]

        const bySource = new Map<string, Edge[]>()
        const byTarget = new Map<string, Edge[]>()
        const byId = new Map<string, Edge>()

        for (const edge of edges) {
            const sourceEdges = bySource.get(edge.source) || []
            sourceEdges.push(edge)
            bySource.set(edge.source, sourceEdges)

            const targetEdges = byTarget.get(edge.target) || []
            targetEdges.push(edge)
            byTarget.set(edge.target, targetEdges)

            byId.set(edge.id, edge)
        }
        const context = {
            nodeIndex: new Map(nodes.map(node => [node.id, node])),
            edgeIndex: { bySource, byTarget, byId },
            nodeOutputs: new Map([
                [nodes[0].id, 'function sayHello() { return "Hello \'World\'!" }'],
                [nodes[2].id, '--flag="custom value" \'single quoted value\''],
            ]),
        }

        const combinedOutputs = combineParentOutputsByConnectionOrder(nodes[3].id, context)
        expect(combinedOutputs).toHaveLength(2)
        expect(combinedOutputs[0]).toBe('function sayHello() { return "Hello \'World\'!" }')
        expect(combinedOutputs[1]).toBe('--flag="custom value" \'single quoted value\'')

        const sanitizedOutput1 = sanitizeForShell(combinedOutputs[0])
        const sanitizedOutput2 = sanitizeForShell(combinedOutputs[1])

        expect(sanitizedOutput1).toBe('function sayHello() { return "Hello \'World\'!" }')
        expect(sanitizedOutput2).toBe('--flag="custom value" \'single quoted value\'')

        const commandTemplate = 'echo ${1} ${2}'
        const replacedCommand = replaceIndexedInputs(commandTemplate, combinedOutputs)
        expect(replacedCommand).toBe(
            'echo function sayHello() { return "Hello \'World\'!" } --flag="custom value" \'single quoted value\''
        )
    })
})
