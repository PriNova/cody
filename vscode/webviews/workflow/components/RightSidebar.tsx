import clsx from 'clsx'
import { useEffect, useState } from 'react'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '../../components/shadcn/ui/accordion'
import { Button } from '../../components/shadcn/ui/button'
import { Textarea } from '../../components/shadcn/ui/textarea'
import { NodeType, type WorkflowNode } from './nodes/Nodes'

interface RightSidebarProps {
    sortedNodes: WorkflowNode[]
    nodeResults: Map<string, string>
    executingNodeId: string | null
    pendingApprovalNodeId: string | null
    onApprove: (nodeId: string, approved: boolean, modifiedCommand?: string) => void
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
    sortedNodes,
    nodeResults,
    executingNodeId,
    pendingApprovalNodeId,
    onApprove,
}) => {
    const filteredNodes = sortedNodes.filter(node => node.type !== NodeType.PREVIEW)
    const getBorderColorClass = (nodeId: string): string => {
        if (nodeId === executingNodeId) {
            return 'tw-border-[var(--vscode-charts-yellow)]' // Same color as executing state in Node.tsx
        }
        return 'tw-border-transparent'
    }
    const [openItemId, setOpenItemId] = useState<string | undefined>(undefined)
    const [modifiedCommands, setModifiedCommands] = useState<Map<string, string>>(new Map())
    const handleCommandChange = (nodeId: string, value: string) => {
        setModifiedCommands(prev => new Map(prev).set(nodeId, value))
    }

    useEffect(() => {
        if (pendingApprovalNodeId) {
            setOpenItemId(pendingApprovalNodeId)
        }
    }, [pendingApprovalNodeId])

    useEffect(() => {
        if (executingNodeId !== null) {
            setModifiedCommands(new Map())
        }
    }, [executingNodeId])

    useEffect(() => {
        if (pendingApprovalNodeId !== null) {
            setModifiedCommands(new Map())
        }
    }, [pendingApprovalNodeId])

    return (
        <div className="tw-w-full tw-border-r tw-border-border tw-h-full tw-bg-sidebar-background tw-p-4">
            <div className="tw-flex tw-flex-col tw-gap-2 tw-mb-4">
                <h3 className="tw-text-[var(--vscode-sideBarTitle-foreground)] tw-font-medium tw-mb-4">
                    Workflow Execution Order & Results
                </h3>
                <div className="tw-space-y-2">
                    {filteredNodes.map((node, index) => (
                        <div
                            key={node.id}
                            className={clsx(
                                'tw-flex tw-flex-col tw-gap-2 tw-p-2 tw-rounded tw-bg-[var(--vscode-sideBar-dropBackground)]',
                                'tw-border-2',
                                getBorderColorClass(node.id)
                            )}
                        >
                            <Accordion
                                type="single"
                                collapsible
                                value={openItemId}
                                onValueChange={value => setOpenItemId(value || '')}
                            >
                                <AccordionItem value={node.id}>
                                    <AccordionTrigger>
                                        {index + 1}. {node.data.title}
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        {nodeResults.has(node.id) && (
                                            <div className="tw-mt-1">
                                                <Textarea
                                                    value={
                                                        modifiedCommands.get(node.id) ||
                                                        nodeResults.get(node.id) ||
                                                        ''
                                                    }
                                                    readOnly={node.id !== pendingApprovalNodeId}
                                                    onChange={e =>
                                                        handleCommandChange(node.id, e.target.value)
                                                    }
                                                />
                                                {node.type === NodeType.CLI &&
                                                    node.id === pendingApprovalNodeId && (
                                                        <div className="tw-flex tw-w-full tw-gap-2 tw-mt-2 tw-justify-center">
                                                            <Button
                                                                onClick={() =>
                                                                    onApprove(
                                                                        node.id,
                                                                        true,
                                                                        modifiedCommands.get(node.id)
                                                                    )
                                                                }
                                                                variant="secondary"
                                                                style={{
                                                                    backgroundColor:
                                                                        'var(--vscode-testing-iconPassed)',
                                                                    color: 'var(--vscode-button-foreground)',
                                                                }}
                                                            >
                                                                Approve
                                                            </Button>
                                                            <Button
                                                                onClick={() => onApprove(node.id, false)}
                                                                variant="secondary"
                                                                style={{
                                                                    backgroundColor:
                                                                        'var(--vscode-charts-red)',
                                                                    color: 'var(--vscode-button-foreground)',
                                                                }}
                                                            >
                                                                Reject
                                                            </Button>
                                                        </div>
                                                    )}
                                            </div>
                                        )}
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
