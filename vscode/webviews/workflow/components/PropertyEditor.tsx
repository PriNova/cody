import type React from 'react'
import { Button } from '../../components/shadcn/ui/button'
import { Input } from '../../components/shadcn/ui/input'
import { Label } from '../../components/shadcn/ui/label'
import { Textarea } from '../../components/shadcn/ui/textarea'
import { NodeType, type WorkflowNode } from './nodes/Nodes'

interface PropertyEditorProps {
    node: WorkflowNode
    onUpdate: (nodeId: string, data: Partial<WorkflowNode['data']>) => void
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({ node, onUpdate }) => {
    return (
        <div className="tw-flex tw-flex-col tw-gap-4">
            <div>
                <Label htmlFor="node-title">Node ID: {node.id}</Label>
            </div>
            <div>
                <Label htmlFor="node-title">Title</Label>
                <Input
                    id="node-title"
                    value={node.data.title}
                    onChange={(e: { target: { value: any } }) =>
                        onUpdate(node.id, { title: e.target.value })
                    }
                />
            </div>

            {node.type === NodeType.CLI && (
                <div>
                    <Label htmlFor="node-command">Command</Label>
                    <Input
                        id="node-command"
                        value={node.data.command || ''}
                        onChange={(e: { target: { value: any } }) =>
                            onUpdate(node.id, { command: e.target.value })
                        }
                        placeholder="Enter CLI command... (use ${1}, ${2} and so on for positional inputs)"
                    />
                </div>
            )}

            {node.type === NodeType.LLM && (
                <div>
                    <Label htmlFor="node-prompt">Prompt</Label>
                    <Textarea
                        id="node-prompt"
                        value={node.data.prompt || ''}
                        onChange={(e: { target: { value: any } }) =>
                            onUpdate(node.id, { prompt: e.target.value })
                        }
                        placeholder="Enter LLM prompt... (use ${1}, ${2} and so on for positional inputs)"
                    />
                </div>
            )}

            {(node.type === NodeType.INPUT || node.type === NodeType.SEARCH_CONTEXT) && (
                <div>
                    <Label htmlFor="node-input">Input Text</Label>
                    <Textarea
                        id="node-input"
                        value={node.data.content || ''}
                        onChange={(e: { target: { value: any } }) =>
                            onUpdate(node.id, { content: e.target.value })
                        }
                        placeholder="Enter input text... (use ${1}, ${2} and so on for positional inputs)"
                    />
                </div>
            )}
            {node.type === NodeType.PREVIEW && (
                <div className="tw-flex tw-flex-col tw-gap-2">
                    <div className="tw-flex tw-gap-2">
                        <Button
                            className="tw-w-full tw-px-4 tw-py-2 tw-bg-red-500 tw-text-white tw-rounded hover:tw-bg-red-600"
                            onClick={() => onUpdate(node.id, { content: '' })}
                            title="Clear content"
                            variant={'secondary'}
                        >
                            Clear Content
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
