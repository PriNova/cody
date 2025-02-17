import type { Model } from '@sourcegraph/cody-shared'
import { Edit, File, Save, Trash2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '../../components/shadcn/ui/accordion'
import { Button } from '../../components/shadcn/ui/button'
import { Input } from '../../components/shadcn/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/shadcn/ui/tooltip'
import { HelpModal } from './HelpModal'
import { PropertyEditor } from './PropertyEditor'
import { NodeType, type WorkflowNodes } from './nodes/Nodes'

interface WorkflowSidebarProps {
    onNodeAdd: (nodeOrLabel: WorkflowNodes | string, nodeType?: NodeType) => void
    selectedNode?: WorkflowNodes | null
    onNodeUpdate?: (nodeId: string, data: Partial<WorkflowNodes['data']>) => void
    onSave?: () => void
    onLoad?: () => void
    onExecute?: () => void
    onClear?: () => void
    isExecuting?: boolean
    onAbort?: () => void
    models: Model[]
    onSaveCustomNode: (node: WorkflowNodes) => void
    onDeleteCustomNode: (nodeId: string) => void
    onRenameCustomNode: (oldNodeTitle: string, newNodeTitle: string) => void
    customNodes: WorkflowNodes[]
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
    onSaveCustomNode,
    customNodes,
    onDeleteCustomNode,
    onRenameCustomNode,
}) => {
    const handleSave = async (): Promise<void> => {
        // Send message to VSCode extension to handle file saving
        if (onSave) {
            onSave()
        }
    }

    const [propertyEditorOpen, setPropertyEditorOpen] = useState<string | undefined>(undefined)
    const [isHelpOpen, setIsHelpOpen] = useState(false)
    const [renamingNode, setRenamingNode] = useState<string | null>(null)
    const [newNodeTitle, setNewNodeTitle] = useState<string>('')

    useEffect(() => {
        if (selectedNode) {
            setPropertyEditorOpen('property_editor')
        }
        if (!selectedNode) {
            setPropertyEditorOpen(undefined)
        }
    }, [selectedNode])

    const handleRenameClick = (nodeTitle: string) => {
        setRenamingNode(nodeTitle)
        setNewNodeTitle(nodeTitle)
    }

    const handleRenameConfirm = (oldNodeTitle: string) => {
        if (onRenameCustomNode && newNodeTitle) {
            onRenameCustomNode(oldNodeTitle, newNodeTitle)
            setRenamingNode(null)
            setNewNodeTitle('')
        }
    }

    const handleRenameCancel = () => {
        setRenamingNode(null)
        setNewNodeTitle('')
    }

    return (
        <div className="tw-w-full tw-border-r tw-border-border tw-h-full tw-bg-sidebar-background tw-p-4">
            <div className="tw-flex tw-flex-col tw-gap-2 tw-mb-2">
                <div className="tw-flex tw-flex-row tw-gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" className="tw-flex-1" onClick={onLoad}>
                                <File />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open Workflow</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" className="tw-flex-1" onClick={handleSave}>
                                <Save />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Save Workflow</TooltipContent>
                    </Tooltip>
                </div>
                <Button
                    variant="outline"
                    className="tw-w-full"
                    onClick={() => {
                        if (isExecuting && onAbort) {
                            onAbort()
                        } else if (onExecute) {
                            onExecute()
                        }
                    }}
                    disabled={false}
                >
                    {isExecuting ? 'Stop Execution' : 'Execute'}
                </Button>{' '}
                <Button variant="outline" className="tw-w-full" onClick={onClear}>
                    Clear Workflow
                </Button>
                <Button variant="outline" className="tw-w-full" onClick={() => setIsHelpOpen(true)}>
                    Show Help
                </Button>
            </div>

            <div className="tw-my-4 tw-border-t tw-border-border" />

            <Accordion type="single" collapsible>
                <AccordionItem value="cli">
                    <AccordionTrigger>Shell Nodes</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Shell Command', NodeType.CLI)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                Shell
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="llm">
                    <AccordionTrigger>Cody AI Nodes</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Cody AI', NodeType.LLM)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                Cody AI
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="preview">
                    <AccordionTrigger>Preview Nodes</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Preview', NodeType.PREVIEW)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                Preview
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="input">
                    <AccordionTrigger>Text Nodes</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Text', NodeType.INPUT)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                Text
                            </Button>
                            <Button
                                onClick={() => onNodeAdd('Accumulator', NodeType.ACCUMULATOR)} // ADD ACCUMULATOR BUTTON
                                className="tw-w-full"
                                variant="outline"
                            >
                                Accumulator
                            </Button>
                            <Button
                                onClick={() => onNodeAdd('Variable', NodeType.VARIABLE)} // ADD VARIABLE BUTTON
                                className="tw-w-full"
                                variant="outline"
                            >
                                Variable
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="conditionals">
                    <AccordionTrigger>Conditionals</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('If/Else', NodeType.IF_ELSE)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                If/Else
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="context">
                    <AccordionTrigger>Context Nodes</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Search Context', NodeType.SEARCH_CONTEXT)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                Search Context
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                {false && (
                    <AccordionItem value="outputs">
                        <AccordionTrigger>Outputs</AccordionTrigger>
                        <AccordionContent>
                            <div className="tw-flex tw-flex-col tw-gap-2">
                                <Button
                                    onClick={() => onNodeAdd('CodyOutput', NodeType.CODY_OUTPUT)}
                                    className="tw-w-full"
                                    variant="outline"
                                >
                                    Cody Output
                                </Button>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                )}
                <AccordionItem value="loop">
                    <AccordionTrigger>Loop Nodes</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <Button
                                onClick={() => onNodeAdd('Loop Start', NodeType.LOOP_START)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                Loop Start
                            </Button>
                            <Button
                                onClick={() => onNodeAdd('Loop End', NodeType.LOOP_END)}
                                className="tw-w-full"
                                variant="outline"
                            >
                                Loop End
                            </Button>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                {/* Custom Nodes Accordion */}
                <AccordionItem value="custom-nodes">
                    <AccordionTrigger>Custom Nodes</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            {customNodes.map((node: any) => (
                                <div
                                    key={node.id}
                                    className="tw-flex tw-flex-row tw-gap-2 tw-items-center"
                                >
                                    {renamingNode === node.data.title ? (
                                        <>
                                            <Input
                                                type="text"
                                                value={newNodeTitle}
                                                onChange={e => setNewNodeTitle(e.target.value)}
                                                className="tw-flex-1"
                                            />
                                            <Button
                                                onClick={() => handleRenameConfirm(node.data.title)}
                                                variant="secondary"
                                                size="sm"
                                            >
                                                Confirm
                                            </Button>
                                            <Button
                                                onClick={handleRenameCancel}
                                                variant="ghost"
                                                size="sm"
                                            >
                                                Cancel
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button
                                                onClick={() => onNodeAdd(node)}
                                                className="tw-flex-1"
                                                variant="secondary"
                                                size={'sm'}
                                                style={{
                                                    height: '24px',
                                                    minHeight: '24px',
                                                    padding: '2px 8px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                <span className="tw-truncate">{node.data.title}</span>
                                            </Button>
                                            <Button
                                                onClick={() => handleRenameClick(node.data.title)}
                                                variant="secondary"
                                                size="sm"
                                                className="tw-h-6 tw-w-6 tw-p-0"
                                                style={{
                                                    height: '24px',
                                                    minHeight: '24px',
                                                    width: '24px',
                                                    padding: '2px',
                                                }}
                                            >
                                                <Edit className="tw-h-6 tw-w-6" />
                                            </Button>
                                            <Button
                                                onClick={() => onDeleteCustomNode(node.data.title)}
                                                variant="secondary"
                                                size="sm"
                                                className="tw-h-6 tw-w-6 tw-p-0"
                                                style={{
                                                    height: '24px',
                                                    minHeight: '24px',
                                                    width: '24px',
                                                    padding: '2px',
                                                }}
                                            >
                                                <Trash2 className="tw-h-6 tw-w-6" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            ))}
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
                                    onSaveCustomNode={onSaveCustomNode}
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
