import type React from 'react'
import { Button } from '../../components/shadcn/ui/button'
import { Checkbox } from '../../components/shadcn/ui/checkbox'
import { Input } from '../../components/shadcn/ui/input'
import { Label } from '../../components/shadcn/ui/label'
import { Slider } from '../../components/shadcn/ui/slider'
import { Textarea } from '../../components/shadcn/ui/textarea'
import { type LLMNode, type LoopStartNode, NodeType, type WorkflowNodes } from './nodes/Nodes'

interface PropertyEditorProps {
    node: WorkflowNodes
    onUpdate: (nodeId: string, data: Partial<WorkflowNodes['data']>) => void
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({ node, onUpdate }) => {
    return (
        <div className="tw-flex tw-flex-col tw-gap-4">
            <div className="tw-flex tw-items-center tw-space-x-2">
                <Checkbox
                    id="node-active"
                    checked={node.data.active !== false} // Default to true if undefined
                    onCheckedChange={checked => onUpdate(node.id, { active: checked === true })}
                />
                <Label htmlFor="node-active">Node Active</Label>
            </div>
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
                <div className="tw-flex tw-flex-col tw-gap-2">
                    <Label htmlFor="node-command">Command</Label>
                    <Input
                        id="node-command"
                        value={node.data.content}
                        onChange={(e: { target: { value: any } }) =>
                            onUpdate(node.id, { content: e.target.value })
                        }
                        placeholder="Enter CLI command... (use ${1}, ${2} and so on for positional inputs)"
                    />
                    <div className="tw-flex tw-items-center tw-space-x-2">
                        <Checkbox
                            id="node-approval"
                            checked={node.data.needsUserApproval || false}
                            onCheckedChange={checked =>
                                onUpdate(node.id, { needsUserApproval: checked === true })
                            }
                        />
                        <Label htmlFor="node-approval">Require User Approval</Label>
                    </div>
                </div>
            )}
            {node.type === NodeType.LLM && (
                <>
                    <div>
                        <Label htmlFor="node-prompt">Prompt</Label>
                        <Textarea
                            id="node-prompt"
                            value={node.data.content || ''}
                            onChange={(e: { target: { value: any } }) =>
                                onUpdate(node.id, { content: e.target.value })
                            }
                            placeholder="Enter LLM prompt... (use ${1}, ${2} and so on for positional inputs)"
                        />
                    </div>
                    <div>
                        <Label htmlFor="node-temperature">Temperature</Label>
                        <Slider
                            className="tw-p-4"
                            id="node-temperature"
                            min={0}
                            max={1}
                            step={0.05}
                            value={[(node as LLMNode).data.temperature || 0]}
                            onValueChange={([value]) => onUpdate(node.id, { temperature: value })}
                        />
                        <span className="tw-text-sm tw-text-muted-foreground">
                            {(node as LLMNode).data.temperature || 0}
                        </span>
                    </div>

                    <div className="tw-flex tw-items-center tw-space-x-2">
                        <Checkbox
                            id="node-fast"
                            checked={(node as LLMNode).data.fast || false}
                            onCheckedChange={checked => onUpdate(node.id, { fast: checked === true })}
                        />
                        <Label htmlFor="node-fast">Fast Mode</Label>
                    </div>
                    <div>
                        <Label htmlFor="node-maxTokens">Maximum Tokens</Label>
                        <Slider
                            className="tw-p-4"
                            id="node-maxTokens"
                            min={250}
                            max={4000}
                            step={250}
                            value={[(node as LLMNode).data.maxTokens || 250]}
                            onValueChange={([value]) => onUpdate(node.id, { maxTokens: value })}
                        />
                        <span className="tw-text-sm tw-text-muted-foreground">
                            {(node as LLMNode).data.maxTokens || 250}
                        </span>
                    </div>
                </>
            )}
            {node.type === NodeType.INPUT && (
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
            {node.type === NodeType.SEARCH_CONTEXT && (
                <div>
                    <Label htmlFor="node-input">Context</Label>
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
            {node.type === NodeType.LOOP_START && (
                <div className="tw-flex tw-flex-col tw-gap-4">
                    <div>
                        <Label htmlFor="loop-iterations">Iterations</Label>
                        <Input
                            id="loop-iterations"
                            type="number"
                            min={1}
                            max={100}
                            value={(node as LoopStartNode).data.iterations || 1}
                            onChange={(e: { target: { value: any } }) =>
                                onUpdate(node.id, { iterations: Number.parseInt(e.target.value, 10) })
                            }
                        />
                    </div>
                    <div>
                        <Label htmlFor="loop-variable">Loop Variable Name</Label>
                        <Input
                            id="loop-variable"
                            value={(node as LoopStartNode).data.loopVariable || 'i'}
                            onChange={(e: { target: { value: any } }) =>
                                onUpdate(node.id, { loopVariable: e.target.value })
                            }
                            placeholder="Variable name (e.g. i, counter, index)"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
