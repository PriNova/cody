import type React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/shadcn/ui/dialog'

interface HelpModalProps {
    isOpen: boolean
    onClose: () => void
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
    return (
        <Dialog open={isOpen} onOpenChange={() => onClose()}>
            <DialogContent className="tw-max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Workflow Editor Help</DialogTitle>
                </DialogHeader>
                <div className="tw-space-y-4">
                    <section>
                        <h3 className="tw-font-semibold tw-mb-2">Viewport Controls</h3>
                        <ul className="tw-list-disc tw-pl-5 tw-space-y-1">
                            <li>Pan: Click and drag on empty space</li>
                            <li>Zoom: Mouse wheel</li>
                        </ul>
                    </section>
                    <section>
                        <h3 className="tw-font-semibold tw-mb-2">Node Operations</h3>
                        <ul className="tw-list-disc tw-pl-5 tw-space-y-1">
                            <li>Add Node: Use buttons in the sidebar</li>
                            <li>Move Node: Drag and drop</li>
                            <li>Clone Node: Shift + Drag</li>
                            <li>Delete Node: Select and press Delete/Backspace</li>
                            <li>Edit Node: Click to select and use Property Editor</li>
                            <li>Shift + Drag: Select multiple nodes</li>
                        </ul>
                    </section>
                    <section>
                        <h3 className="tw-font-semibold tw-mb-2">Connections</h3>
                        <ul className="tw-list-disc tw-pl-5 tw-space-y-1">
                            <li>Connect Nodes: Drag from handle to handle</li>
                            <li>Delete Connection: Select and press Delete/Backspace</li>
                            <li>Connection Order: Shown by numbers on edges</li>
                        </ul>
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    )
}
