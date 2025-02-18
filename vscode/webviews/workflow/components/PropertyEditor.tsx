import { type Model, ModelTag } from '@sourcegraph/cody-shared'
import { Save } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/shadcn/ui/button'
import { Checkbox } from '../../components/shadcn/ui/checkbox'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '../../components/shadcn/ui/command'
import { Input } from '../../components/shadcn/ui/input'
import { Label } from '../../components/shadcn/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/shadcn/ui/popover'
import { Slider } from '../../components/shadcn/ui/slider'
import { Textarea } from '../../components/shadcn/ui/textarea'
import type { AccumulatorNode } from './nodes/Accumulator_Node'
import type { LLMNode } from './nodes/LLM_Node'
import type { LoopStartNode } from './nodes/LoopStart_Node'
import { NodeType, type WorkflowNodes } from './nodes/Nodes'
import type { SearchContextNode } from './nodes/SearchContext_Node'
import type { VariableNode } from './nodes/Variable_Node'

interface PropertyEditorProps {
    node: WorkflowNodes
    onUpdate: (nodeId: string, data: Partial<WorkflowNodes['data']>) => void
    models: Model[]
    onSaveCustomNode: (node: WorkflowNodes) => void
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({
    node,
    onUpdate,
    models,
    onSaveCustomNode,
}) => {
    const [open, setOpen] = useState(false)
    const [selectedModel, setSelectedModel] = useState<Model | undefined>(undefined)

    useEffect(() => {
        if (node.type === NodeType.LLM) {
            setSelectedModel((node as LLMNode).data.model)
        } else {
            setSelectedModel(undefined)
        }
    }, [node])

    const onModelSelect = useCallback(
        (model: Model) => {
            setSelectedModel(model)
            setOpen(false)
            onUpdate(node.id, { model: { ...model } })
        },
        [node.id, onUpdate]
    )

    const handleSaveCustomNode = () => {
        if (
            node.type !== NodeType.LOOP_START &&
            node.type !== NodeType.LOOP_END &&
            node.type !== NodeType.IF_ELSE &&
            node.type !== NodeType.PREVIEW
        ) {
            onSaveCustomNode(node)
        }
    }

    return (
        <div className="tw-flex tw-flex-col tw-gap-4">
            <div className="tw-flex tw-items-center tw-space-x-2">
                <Checkbox
                    id="node-active"
                    checked={node.data.active !== false} // Default to true if undefined
                    onCheckedChange={checked => onUpdate(node.id, { active: checked !== false })}
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
                    <Button variant="secondary" onClick={handleSaveCustomNode} className="tw-w-full">
                        <Save className="tw-mr-2" size={14} />
                        Save as Custom Node
                    </Button>

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
                        <Checkbox
                            id="node-aborting"
                            checked={node.data.shouldAbort || false}
                            onCheckedChange={checked =>
                                onUpdate(node.id, { shouldAbort: checked === true })
                            }
                        />
                        <Label htmlFor="node-aborting">Abort on Error</Label>
                    </div>
                </div>
            )}
            {node.type === NodeType.LLM && (
                <div className="tw-flex tw-flex-col tw-gap-2">
                    <Button variant="secondary" onClick={handleSaveCustomNode} className="tw-w-full">
                        <Save className="tw-mr-2" size={14} />
                        Save as Custom Node
                    </Button>
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
                    {models && (
                        <div>
                            <Label htmlFor="model-select">Model</Label>
                            <Popover open={open} onOpenChange={setOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="secondary"
                                        role="combobox"
                                        aria-controls="model-menu"
                                        aria-expanded={open}
                                        className="tw-w-full justify-between"
                                    >
                                        {(
                                            selectedModel?.modelRef?.modelId ||
                                            (node as LLMNode).data.model?.modelRef?.modelId ||
                                            'Select a model'
                                        )
                                            .charAt(0)
                                            .toUpperCase() +
                                            (
                                                selectedModel?.modelRef?.modelId ||
                                                (node as LLMNode).data.model?.modelRef?.modelId ||
                                                'Select a model'
                                            ).slice(1)}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="tw-p-0" side="bottom" align="start">
                                    <Command>
                                        <CommandInput
                                            placeholder="Search models..."
                                            className="tw-bg-[var(--vscode-input-background)] tw-text-[var(--vscode-input-foreground)]"
                                        />
                                        <CommandList className="tw-max-h-[200px] tw-overflow-y-auto">
                                            <CommandEmpty>No models found.</CommandEmpty>
                                            {/* First show BYOK models if any exist */}
                                            {models.some(model =>
                                                model.tags?.includes(ModelTag.BYOK)
                                            ) && (
                                                <CommandGroup
                                                    heading="Your Custom Models (BYOK)"
                                                    className="[&_[cmdk-group-heading]]:tw-font-semibold [&_[cmdk-group-heading]]:tw-text-[var(--vscode-editor-foreground)] [&_[cmdk-group-heading]]:tw-bg-[var(--vscode-editor-selectionBackground)] [&_[cmdk-group-heading]]:tw-px-2 [&_[cmdk-group-heading]]:tw-py-1"
                                                >
                                                    {models
                                                        .filter(model =>
                                                            model.tags?.includes(ModelTag.BYOK)
                                                        )
                                                        .map(model => (
                                                            <CommandItem
                                                                key={model.id}
                                                                value={model.modelRef?.modelId}
                                                                onSelect={() => onModelSelect(model)}
                                                            >
                                                                {model.modelRef?.modelId}
                                                            </CommandItem>
                                                        ))}
                                                </CommandGroup>
                                            )}
                                            {/* Then show provider-based groups for non-BYOK models */}
                                            {Object.entries(
                                                models
                                                    .filter(
                                                        model => !model.tags?.includes(ModelTag.BYOK)
                                                    )
                                                    .reduce(
                                                        (acc, model) => {
                                                            const provider =
                                                                model.modelRef?.providerId || 'Other'
                                                            acc[provider] = acc[provider] || []
                                                            acc[provider].push(model)
                                                            return acc
                                                        },
                                                        {} as Record<string, Model[]>
                                                    )
                                            ).map(([provider, providerModels]) => (
                                                <CommandGroup
                                                    key={provider}
                                                    heading={
                                                        provider.charAt(0).toUpperCase() +
                                                        provider.slice(1)
                                                    }
                                                    className="[&_[cmdk-group-heading]]:tw-font-semibold [&_[cmdk-group-heading]]:tw-text-[var(--vscode-editor-foreground)] [&_[cmdk-group-heading]]:tw-bg-[var(--vscode-editor-selectionBackground)] [&_[cmdk-group-heading]]:tw-px-2 [&_[cmdk-group-heading]]:tw-py-1"
                                                >
                                                    {providerModels.map(model => (
                                                        <CommandItem
                                                            key={model.id}
                                                            value={model.modelRef?.modelId}
                                                            onSelect={() => onModelSelect(model)}
                                                        >
                                                            {model.modelRef?.modelId}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            ))}
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}
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
                </div>
            )}
            {node.type === NodeType.INPUT && (
                <div>
                    <Button variant="secondary" onClick={handleSaveCustomNode} className="tw-w-full">
                        <Save className="tw-mr-2" size={14} />
                        Save as Custom Node
                    </Button>
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
                <div className="tw-flex tw-flex-col tw-gap-2">
                    <Button variant="secondary" onClick={handleSaveCustomNode} className="tw-w-full">
                        <Save className="tw-mr-2" size={14} />
                        Save as Custom Node
                    </Button>
                    <Label htmlFor="node-input">Context</Label>
                    <Textarea
                        id="node-input"
                        value={node.data.content || ''}
                        onChange={(e: { target: { value: any } }) =>
                            onUpdate(node.id, { content: e.target.value })
                        }
                        placeholder="Enter input text... (use ${1}, ${2} and so on for positional inputs)"
                    />
                    <div className="tw-flex tw-items-center tw-space-x-2">
                        <Checkbox
                            id="context-scope"
                            checked={(node as SearchContextNode).data.local_remote || false}
                            onCheckedChange={checked =>
                                onUpdate(node.id, { local_remote: checked === true })
                            }
                        />
                        <Label htmlFor="context-scope">Use Remote Context</Label>
                    </div>
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
            {node.type === NodeType.ACCUMULATOR && (
                <div className="tw-flex tw-flex-col tw-gap-4">
                    <div>
                        <Button variant="secondary" onClick={handleSaveCustomNode} className="tw-w-full">
                            <Save className="tw-mr-2" size={14} />
                            Save as Custom Node
                        </Button>
                        <Label htmlFor="accumulator-variable-name">Unique Variable Name</Label>
                        <Input
                            id="accumulator-variable-name"
                            value={(node as AccumulatorNode).data.variableName || ''}
                            onChange={(e: { target: { value: any } }) =>
                                onUpdate(node.id, { variableName: e.target.value })
                            }
                            placeholder="Unique variable name to access accumulated value (e.g., accumulatedSummary)"
                            required // Make it required for clarity
                        />
                    </div>
                    <div>
                        <Label htmlFor="accumulator-initial-value">Input Text</Label>
                        <Textarea
                            id="node-input"
                            value={node.data.content || ''}
                            onChange={(e: { target: { value: any } }) =>
                                onUpdate(node.id, { content: e.target.value })
                            }
                            placeholder="Enter input text... (use ${1}, ${2} and so on for positional inputs)"
                        />
                    </div>
                </div>
            )}
            {node.type === NodeType.IF_ELSE && (
                <div className="tw-flex tw-flex-col tw-gap-2">
                    <Label htmlFor="node-input">Condition</Label>
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
            {node.type === NodeType.VARIABLE && (
                <div className="tw-flex tw-flex-col tw-gap-4">
                    <div>
                        <Button variant="secondary" onClick={handleSaveCustomNode} className="tw-w-full">
                            <Save className="tw-mr-2" size={14} />
                            Save as Custom Node
                        </Button>
                        <Label htmlFor="variable-name">Variable Name</Label>
                        <Input
                            id="variable-name"
                            value={(node as VariableNode).data.variableName || ''}
                            onChange={(e: { target: { value: any } }) =>
                                onUpdate(node.id, { variableName: e.target.value })
                            }
                            placeholder="Unique variable name to access variable value (e.g., userInput)"
                            required // Make it required for clarity
                        />
                    </div>
                    <div>
                        <Label htmlFor="variable-initial-value">Initial Value</Label>
                        <Textarea
                            id="node-input"
                            value={node.data.content || ''}
                            onChange={(e: { target: { value: any } }) =>
                                onUpdate(node.id, { content: e.target.value })
                            }
                            placeholder="Enter input text... (use ${1}, ${2} and so on for positional inputs)"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
