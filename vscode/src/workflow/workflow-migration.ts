import { NodeType } from '../../webviews/workflow/components/nodes/Nodes'

interface LegacyWorkflowNode {
    id: string
    type: NodeType
    data: {
        title: string
        command?: string
        prompt?: string
        content?: string
        temperature?: number
        fast?: boolean
        maxTokens?: number
    }
    position: { x: number; y: number }
}

export function migrateWorkflowData(data: any) {
    // Check version and apply migrations if needed
    if (!data.version || data.version <= '1.0.0') {
        console.log('Migrating workflow data...')
        return {
            ...data,
            nodes: data.nodes.map((node: LegacyWorkflowNode) => {
                const baseData = {
                    title: node.data.title,
                    content: '',
                    active: true,
                }

                switch (node.type) {
                    case NodeType.CLI:
                        return {
                            ...node,
                            data: {
                                ...baseData,
                                content: node.data.command || '',
                            },
                        }
                    case NodeType.LLM:
                        return {
                            ...node,
                            data: {
                                ...baseData,
                                content: node.data.prompt || '',
                                temperature: node.data.temperature || 0,
                                fast: node.data.fast ?? true,
                                maxTokens: node.data.maxTokens || 1000,
                            },
                        }
                    case NodeType.PREVIEW:
                    case NodeType.INPUT:
                        return {
                            ...node,
                            data: {
                                ...baseData,
                                content: node.data.content || '',
                            },
                        }
                    default:
                        return node
                }
            }),
            version: '1.0.0',
        }
    }
    return data
}
