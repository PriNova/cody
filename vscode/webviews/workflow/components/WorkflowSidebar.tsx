import type { Model } from '@sourcegraph/cody-shared'
import type React from 'react'
import { useEffect, useState } from 'react'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '../../components/shadcn/ui/accordion'
import { Button } from '../../components/shadcn/ui/button'
import { HelpModal } from './HelpModal'
import { PropertyEditor } from './PropertyEditor'
import { NodeType, type WorkflowNodes } from './nodes/Nodes'

interface WorkflowSidebarProps {
    onNodeAdd: (nodeLabel: string, nodeType: NodeType) => void
    selectedNode?: WorkflowNodes | null
    onNodeUpdate?: (nodeId: string, data: Partial<WorkflowNodes['data']>) => void
    onSave?: () => void
    onLoad?: () => void
    onExecute?: () => void
    onClear?: () => void
    isExecuting?: boolean
    onAbort?: () => void
    models: Model[]
}

export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
    onNodeAdd,
    selectedNode,
    onNodeUpdate,
    onSave,
    onLoad,
    onExecute,
    onClear,
    isExecuting,
    onAbort,
    models,
}) => {
    const handleSave = async (): Promise<void> => {
        // Send message to VSCode extension to handle file saving
        if (onSave) {
            onSave()
        }
    }

    const [propertyEditorOpen, setPropertyEditorOpen] = useState<string | undefined>(undefined)
    const [isHelpOpen, setIsHelpOpen] = useState(false)

    useEffect(() => {
        if (selectedNode) {
            setPropertyEditorOpen('property_editor')
        }
        if (!selectedNode) {
            setPropertyEditorOpen(undefined)
        }
    }, [selectedNode])

    return (
        <div className="tw-w-full tw-border-r tw-border-border tw-h-full tw-bg-sidebar-background tw-p-4">
            <div className="tw-flex tw-flex-col tw-gap-2 tw-mb-4">
                <Button variant="secondary" className="tw-w-full" onClick={onLoad}>
                    Open Workflow
                </Button>
                <Button variant="secondary" className="tw-w-full" onClick={handleSave}>
                    Save Workflow
                </Button>
                <Button
                    variant="secondary"
                    className="tw-w-full"
                    onClick={() => {
                        if (isExecuting && onAbort) {
                            onAbort()
                        } else if (onExecute) {
                            onExecute()
                        }
                    }}
                    disabled={false} // Remove disabled state to allow abort
                >
                    {isExecuting ? 'Stop Execution' : 'Execute'}
                </Button>
                <Button variant="secondary" className="tw-w-full" onClick={onClear}>
                    Clear Workflow
                </Button>

                <Button variant="secondary" className="tw-w-full" onClick={() => setIsHelpOpen(true)}>
                    Show Help
                </Button>
            </div>

            <div className="tw-my-4 tw-border-t tw-border-border" />
            <Accordion type="single" collapsible>
                <AccordionItem value="cli">
                    <AccordionTrigger>CLI Actions</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('CLI Command', NodeType.CLI)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                CLI command
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="llm">
                    <AccordionTrigger>Cody AI Actions</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Cody', NodeType.LLM)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                Cody
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="preview">
                    <AccordionTrigger>Preview</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Preview', NodeType.PREVIEW)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                Preview
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="input">
                    <AccordionTrigger>Input Text</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Text', NodeType.INPUT)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                Input Text
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="context">
                    <AccordionTrigger>Context Items</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('SearchContext', NodeType.SEARCH_CONTEXT)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                Fetch Context
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="outputs">
                    <AccordionTrigger>Outputs</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('CodyOutput', NodeType.CODY_OUTPUT)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                Cody Output
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="loop">
                    <AccordionTrigger>Loop Control</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Loop Start', NodeType.LOOP_START)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                Loop Start
                            </Button>
                            <Button
                                onClick={() => onNodeAdd('Loop End', NodeType.LOOP_END)}
                                className="tw-w-full"
                                variant="secondary"
                            >
                                Loop End
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
            <Accordion
                type="single"
                value={propertyEditorOpen}
                onValueChange={setPropertyEditorOpen}
                collapsible
            >
                <div className="tw-my-4 tw-border-t tw-border-border" />
                <AccordionItem value="property_editor">
                    <AccordionTrigger>Property Editor</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-p-2">
                            {selectedNode ? (
                                <PropertyEditor
                                    node={selectedNode}
                                    onUpdate={onNodeUpdate || (() => {})}
                                    models={models}
                                />
                            ) : (
                                <p className="tw-text-sm tw-text-muted-foreground tw-mt-2">
                                    Select a node to edit its properties
                                </p>
                            )}
                        </div>
                        <div className="tw-my-4 tw-border-t tw-border-border" />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
        </div>
    )
}
