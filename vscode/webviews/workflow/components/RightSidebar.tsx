import clsx from 'clsx'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '../../components/shadcn/ui/accordion'
import { Textarea } from '../../components/shadcn/ui/textarea'
import { NodeType, type WorkflowNode } from './nodes/Nodes'

interface RightSidebarProps {
    sortedNodes: WorkflowNode[]
    nodeResults: Map<string, string>
    executingNodeId: string | null
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
    sortedNodes,
    nodeResults,
    executingNodeId,
}) => {
    const filteredNodes = sortedNodes.filter(node => node.type !== NodeType.PREVIEW)
    const getBorderColorClass = (nodeId: string): string => {
        if (nodeId === executingNodeId) {
            return 'tw-border-[var(--vscode-charts-yellow)]' // Same color as executing state in Node.tsx
        }
        return 'tw-border-transparent'
    }
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
                            <Accordion type="single" collapsible>
                                <AccordionItem value="property_editor">
                                    <AccordionTrigger>
                                        {index + 1}. {node.data.title}
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        {nodeResults.has(node.id) && (
                                            <div className="tw-mt-1 tw-p-2 tw-rounded tw-text-sm tw-bg-[var(--vscode-input-background)] tw-text-[var(--vscode-input-foreground)] tw-font-mono">
                                                <Textarea
                                                    id="node-input"
                                                    value={nodeResults.get(node.id) || ''}
                                                    placeholder="Enter input text... (use ${1}, ${2} and so on for positional inputs)"
                                                    readOnly={true}
                                                />
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
