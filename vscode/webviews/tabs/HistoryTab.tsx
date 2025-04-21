import { useExtensionAPI, useObservable } from '@sourcegraph/prompt-editor'
import {
    HistoryIcon,
    MessageSquarePlusIcon,
    MessageSquareTextIcon,
    PenIcon,
    TrashIcon,
    XCircleIcon, // Use XCircleIcon for consistency with fork's clear button
} from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { CodyIDE } from '@sourcegraph/cody-shared'
import type {
    LightweightChatHistory,
    LightweightChatTranscript,
} from '@sourcegraph/cody-shared/src/chat/transcript'
import type { WebviewType } from '../../src/chat/protocol'
import { LoadingDots } from '../chat/components/LoadingDots'
import { CollapsiblePanel } from '../components/CollapsiblePanel'
import { Button } from '../components/shadcn/ui/button'
import { Command, CommandInput, CommandItem, CommandList } from '../components/shadcn/ui/command'
import { useUserHistory } from '../components/useUserHistory'
import { getVSCodeAPI } from '../utils/VSCodeApi'
// Import the CSS module
import styles from './HistoryTab.module.css'
import { View } from './types'
import { getCreateNewChatCommand } from './utils'

// Type alias for brevity
type Chat = LightweightChatTranscript

interface HistoryTabProps {
    IDE: CodyIDE
    setView: (view: View) => void
    webviewType?: WebviewType | undefined | null
    multipleWebviewsEnabled?: boolean | undefined | null
    // Add props for controlled search state (from fork)
    searchQuery: string
    onSearchQueryChange: (query: string) => void
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
    IDE,
    webviewType,
    multipleWebviewsEnabled,
    setView,
    extensionAPI,
}) => {
    const userHistory = useUserHistory()
    const chats = useMemo(() => (userHistory ? Object.values(userHistory) : userHistory), [userHistory])

    return (
        <div className="tw-flex tw-overflow-hidden tw-h-full tw-w-full">
            {!chats ? (
                <LoadingDots />
            ) : chats === null ? (
                <p>History is not available.</p>
            ) : (
                // Pass down searchQuery and onSearchQueryChange
                <HistoryTabWithData {...props} chats={chats} />
            )}
        </div>
    )
}

// Add searchQuery and onSearchQueryChange to the props type
interface HistoryTabWithDataProps extends HistoryTabProps {
    chats: Chat[]
}

export const HistoryTabWithData: React.FC<HistoryTabWithDataProps> = ({
    IDE,
    webviewType,
    multipleWebviewsEnabled,
    setView,
    chats,
    // Destructure the search props
    searchQuery,
    onSearchQueryChange,
}) => {
    // Editing State (from fork)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [newTitle, setNewTitle] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    // Filter out chats without a first message (as per origin/main)
    const nonEmptyChats = useMemo(() => chats.filter(c => c?.firstHumanMessageText?.length), [chats])

    // Search Logic: Use the passed-in searchQuery prop (from fork's pattern)
    const filteredChats = useMemo(() => {
        const searchTerm = searchQuery.trim().toLowerCase() // Use prop here
        if (!searchTerm) {
            return nonEmptyChats
        }
        return nonEmptyChats.filter(chat => {
            if (chat.chatTitle?.toLowerCase().includes(searchTerm)) {
                return true
            }
            return chat.firstHumanMessageText?.toLowerCase().includes(searchTerm) || false
        })
    }, [nonEmptyChats, searchQuery]) // Depend on searchQuery prop

    // Grouping Logic (from origin/main, applied to filtered chats)
    const sortedChatsByPeriod = useMemo(
        () =>
            Array.from(
                [...filteredChats].reverse().reduce((acc, chat) => {
                    const period = getRelativeChatPeriod(new Date(chat.lastInteractionTimestamp))
                    acc.set(period, [...(acc.get(period) || []), chat])
                    return acc
                }, new Map<string, Chat[]>())
            ) as [string, Chat[]][],
        [filteredChats]
    )

    // Callbacks (merged/adapted)
    const onDeleteButtonClick = useCallback(
        (id: string) => {
            if (chats.find(chat => chat.id === id)) {
                getVSCodeAPI().postMessage({
                    command: 'command',
                    id: 'cody.chat.history.clear',
                    arg: id,
                })
            }
            if (editingId === id) {
                setEditingId(null)
            }
        },
        [chats, editingId]
    )

    const handleStartNewChat = useCallback(() => {
        getVSCodeAPI().postMessage({
            command: 'command',
            id: getCreateNewChatCommand({ IDE, webviewType, multipleWebviewsEnabled }),
        })
        setView(View.Chat)
    }, [IDE, webviewType, multipleWebviewsEnabled, setView])

    const onEditButtonClick = useCallback(
        (id: string) => {
            const chat = chats.find(chat => chat.id === id)
            if (chat) {
                setEditingId(id)
                setNewTitle(chat.chatTitle || chat.firstHumanMessageText || '')
                setTimeout(() => inputRef.current?.focus(), 0)
            }
        },
        [chats]
    )

    const onSaveTitle = useCallback((id: string, titleToSave: string) => {
        getVSCodeAPI().postMessage({
            command: 'updateChatTitle',
            chatID: id,
            newTitle: titleToSave.trim(),
        })
        setEditingId(null)
    }, [])

    const handleRestoreHistory = useCallback((chatID: string) => {
        getVSCodeAPI().postMessage({
            command: 'restoreHistory',
            chatID: chatID,
        })
        // Optional: setView(View.Chat)
    }, [])

    return (
        <div className="tw-flex tw-flex-col tw-gap-6">
            {/* Search Input: Controlled by parent state via props */}
            <div className="tw-flex tw-items-center tw-gap-2 tw-py-2">
                <Input
                    className="tw-flex-1 tw-text-sm"
                    placeholder="Search chat history"
                    value={searchQuery} // Use prop for value
                    onChange={event => onSearchQueryChange(event.target.value)} // Use callback prop
                    variant="search"
                />
                {/* Clear button uses callback prop */}
                {searchQuery && (
                    <Button
                        variant="ghost" // Use ghost for less emphasis like fork
                        size="icon"
                        className="tw-ml-1" // Adjust margin if needed
                        onClick={() => onSearchQueryChange('')} // Use callback prop
                        title="Clear search"
                    >
                        <XCircleIcon size={16} strokeWidth={1.25} />
                    </Button>
                )}
            </div>

            {/* Collapsible Sections */}
            {sortedChatsByPeriod.map(([period, periodChats]) => (
                <CollapsiblePanel
                    id={`history-${period}`.replaceAll(' ', '-').toLowerCase()}
                    key={period}
                    storageKey={`history.${period}`}
                    title={period}
                    initialOpen={true}
                >
                    {periodChats.map(chat => {
                        const { id, chatTitle, firstHumanMessageText } = chat
                        const displayTitle = chatTitle || firstHumanMessageText || 'Untitled Chat'

                        return (
                            <div
                                key={id}
                                className="tw-flex tw-flex-row tw-items-center tw-justify-between tw-w-full tw-mb-1 tw-group"
                            >
                                {editingId === id ? (
                                    // Editing Mode UI
                                    <div className="tw-flex tw-w-full tw-gap-2 tw-items-center tw-py-1">
                                        <Input
                                            ref={inputRef}
                                            type="text"
                                            value={newTitle}
                                            onChange={e => setNewTitle(e.target.value)}
                                            className="tw-flex-1 tw-h-8"
                                            variant="search"
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    onSaveTitle(id, newTitle)
                                                } else if (e.key === 'Escape') {
                                                    setEditingId(null)
                                                }
                                            }}
                                            onBlur={() => {
                                                setTimeout(() => {
                                                    if (editingId === id) {
                                                        setEditingId(null)
                                                    }
                                                }, 100)
                                            }}
                                        />
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => onSaveTitle(id, newTitle)}
                                            className="tw-h-8"
                                        >
                                            Save
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setEditingId(null)}
                                            className="tw-h-8"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                ) : (
                                    // Display Mode UI
                                    <>
                                        <Button
                                            variant="ghost"
                                            title={displayTitle}
                                            onClick={() => handleRestoreHistory(id)}
                                            className={`${styles['history-item']} tw-flex tw-items-center tw-max-w-[calc(100%-80px)] tw-text-left tw-truncate tw-gap-2 tw-py-1 tw-px-2 tw-h-8`}
                                        >
                                            <MessageSquareTextIcon
                                                className="tw-flex-shrink-0"
                                                size={16}
                                                strokeWidth="1.25"
                                            />
                                            <span className="tw-truncate">{displayTitle}</span>
                                        </Button>
                                        <div
                                            className={`${styles['history-delete-btn']} tw-flex tw-items-center tw-shrink-0`}
                                        >
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                title="Rename chat"
                                                onClick={() => onEditButtonClick(id)}
                                                className="tw-h-8 tw-w-8"
                                            >
                                                <PenIcon size={16} strokeWidth="1.25" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                title="Delete chat"
                                                onClick={() => onDeleteButtonClick(id)}
                                                className="tw-h-8 tw-w-8"
                                            >
                                                <TrashIcon size={16} strokeWidth="1.25" />
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )
                    })}
                </CollapsiblePanel>
            ))}

            {/* No History Placeholder: Use searchQuery prop for context */}
            {(nonEmptyChats.length === 0 || (searchQuery && filteredChats.length === 0)) && (
                <div className="tw-flex tw-flex-col tw-items-center tw-mt-6">
                    <HistoryIcon
                        size={20}
                        strokeWidth={1.25}
                        className="tw-mb-5 tw-text-muted-foreground"
                    />
                    <span className="tw-text-lg tw-mb-4 tw-text-muted-foreground">
                        {searchQuery ? 'No chats match your search' : 'You have no chat history'}
                    </span>
                    {!searchQuery && (
                        <>
                            <span className="tw-text-sm tw-text-muted-foreground tw-mb-8 tw-text-center">
                                Explore all your previous chats here. Track and <br /> search through
                                what you've been working on.
                            </span>
                            <Button
                                size="sm"
                                variant="secondary"
                                aria-label="Start a new chat"
                                className="tw-px-4 tw-py-2"
                                onClick={handleStartNewChat}
                            >
                                <MessageSquarePlusIcon
                                    size={16}
                                    className="tw-mr-1"
                                    strokeWidth={1.25}
                                />
                                Start a new chat
                            </Button>
                        </>
                    )}
                </div>
            )}
            <CommandList>
                <CommandInput
                    value={searchText}
                    onValueChange={setSearchText}
                    placeholder="Search..."
                    autoFocus={true}
                    className="tw-m-[0.5rem] !tw-p-[0.5rem] tw-rounded tw-bg-input-background tw-text-input-foreground focus:tw-shadow-[0_0_0_0.125rem_var(--vscode-focusBorder)]"
                    disabled={chats.length === 0}
                />
            </CommandList>
            <CommandList className="tw-flex-1 tw-overflow-y-auto tw-m-2">
                {displayedChats.map((chat: LightweightChatTranscript) => {
                    const id = chat.lastInteractionTimestamp
                    const chatTitle = chat.chatTitle
                    const lastMessage = chat.firstHumanMessageText
                    // Show the last interaction timestamp in a human-readable format
                    const timestamp = new Date(chat.lastInteractionTimestamp)
                        .toLocaleString()
                        .replace('T', ', ')
                        .replace('Z', '')

                    return (
                        <CommandItem
                            key={id}
                            className={`tw-text-left tw-truncate tw-w-full tw-rounded-md tw-text-sm ${styles.historyItem} tw-overflow-hidden tw-text-sidebar-foreground tw-align-baseline`}
                            onSelect={() =>
                                vscodeAPI.postMessage({
                                    command: 'restoreHistory',
                                    chatID: id,
                                })
                            }
                        >
                            <div className="tw-truncate tw-w-full tw-flex tw-flex-col tw-gap-2">
                                <div>{chatTitle || lastMessage}</div>
                                <div className="tw-text-left tw-text-muted-foreground">{timestamp}</div>
                            </div>
                            <Button
                                variant="outline"
                                title="Delete chat history"
                                aria-label="delete-history-button"
                                className={styles.deleteButton}
                                onClick={e => onDeleteButtonClick(e, id)}
                                onKeyDown={e => onDeleteButtonClick(e, id)}
                            >
                                <TrashIcon className="tw-w-8 tw-h-8" size={16} strokeWidth="1.25" />
                            </Button>
                        </CommandItem>
                    )
                })}
                {hasMoreItems && (
                    <div ref={loadingRef} className="tw-flex tw-justify-center tw-items-center tw-py-4">
                        {isLoading ? (
                            <LoadingDots />
                        ) : (
                            <span className="tw-text-sm tw-text-muted-foreground">Scroll for more</span>
                        )}
                    </div>
                )}
            </CommandList>
        </Command>
    )
}

function useUserHistory(): LightweightChatHistory | null | undefined {
    const userHistory = useExtensionAPI().userHistory
    return useObservable(useMemo(() => userHistory(), [userHistory])).value
}
