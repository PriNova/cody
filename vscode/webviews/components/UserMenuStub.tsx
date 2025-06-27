import { Settings2Icon } from 'lucide-react'
import type React from 'react'
import { getVSCodeAPI } from '../utils/VSCodeApi'
import { Command, CommandGroup, CommandItem, CommandList } from './shadcn/ui/command'
import { ToolbarPopoverItem } from './shadcn/ui/toolbar'

interface UserMenuStubProps {
    className?: string
    onCloseByEscape?: () => void
}

/**
 * Stub UserMenu component for standalone mode - only shows essential settings
 */
export const UserMenu: React.FunctionComponent<UserMenuStubProps> = ({ className, onCloseByEscape }) => {
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            onCloseByEscape?.()
        }
    }

    return (
        <ToolbarPopoverItem
            role="menu"
            iconEnd={null}
            className={className}
            aria-label="Settings Menu"
            popoverContent={close => (
                <Command className="tw-shadow-lg tw-shadow-border-500/50 focus:tw-outline-none">
                    <CommandList>
                        <CommandGroup>
                            <CommandItem
                                onSelect={() => {
                                    getVSCodeAPI().postMessage({
                                        command: 'command',
                                        id: 'cody.status-bar.interacted',
                                    })
                                    close()
                                }}
                            >
                                <Settings2Icon size={16} strokeWidth={1.25} className="tw-mr-2" />
                                <span className="tw-flex-grow">Extension Settings</span>
                            </CommandItem>
                        </CommandGroup>
                    </CommandList>
                </Command>
            )}
            popoverContentProps={{
                className: '!tw-p-2 tw-mr-6',
                onKeyDown: onKeyDown,
                onCloseAutoFocus: event => {
                    event.preventDefault()
                },
            }}
        >
            <Settings2Icon size={16} className="tw-opacity-70" />
        </ToolbarPopoverItem>
    )
}
