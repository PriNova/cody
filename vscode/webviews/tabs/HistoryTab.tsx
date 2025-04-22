import type { CodyIDE, SerializedChatTranscript, UserLocalHistory } from '@sourcegraph/cody-shared'
import {
    ChatHistoryType,
    type LightweightChatHistory,
} from '@sourcegraph/cody-shared/src/chat/transcript'
import { useExtensionAPI, useObservable } from '@sourcegraph/prompt-editor'
import {
    HistoryIcon,
    MessageSquarePlusIcon,
    MessageSquareTextIcon,
    PenIcon,
    TrashIcon,
} from 'lucide-react'
import { SearchIcon } from 'lucide-react'
import { XCircleIcon } from 'lucide-react'
import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WebviewType } from '../../src/chat/protocol'
import { getRelativeChatPeriod } from '../../src/common/time-date'
import { LoadingDots } from '../chat/components/LoadingDots'
import { CollapsiblePanel } from '../components/CollapsiblePanel'
import { Button } from '../components/shadcn/ui/button'
import { Input } from '../components/shadcn/ui/input'
import { getVSCodeAPI } from '../utils/VSCodeApi'
import { View } from './types'
import { getCreateNewChatCommand } from './utils'

interface HistoryTabProps {
    IDE: CodyIDE
    setView: (view: View) => void
    webviewType?: WebviewType | undefined | null
    multipleWebviewsEnabled?: boolean | undefined | null
    searchQuery: string
    onSearchQueryChange: (query: string) => void
}

export const HistoryTab: React.FC<HistoryTabProps> = props => {
    const userHistory = useUserHistory()
    const chats = useMemo(
        () => (userHistory ? Object.values(userHistory.chat) : userHistory),
        [userHistory]
    )

    return (
        <div className="tw-px-8 tw-pt-6 tw-pb-12">
            {chats === undefined ? (
                <LoadingDots />
            ) : chats === null ? (
                <p>History is not available.</p>
            ) : (
                <HistoryTabWithData {...props} chats={chats} />
            )}
        </div>
    )
}

const filterChatsBySearch = (chats: SerializedChatTranscript[], term: string) => {
    if (!term) return chats

    // Split search term into individual words and remove empty strings
    const searchTerms = term.toLowerCase().split(' ').filter(Boolean)

    return chats.filter(chat => {
        const chatTitle = chat.chatTitle?.toLowerCase() || ''

        // Check if all search terms are present in the title
        const titleMatch = searchTerms.every(term => chatTitle.includes(term))
        if (titleMatch) return true

        // Check interactions for all search terms
        return chat.interactions.some(interaction => {
            const humanText = interaction.humanMessage?.text?.toLowerCase() || ''
            const assistantText = interaction.assistantMessage?.text?.toLowerCase() || ''

            // Return true if all search terms are found in either message
            return searchTerms.every(term => humanText.includes(term) || assistantText.includes(term))
        })
    })
}

export const HistoryTabWithData: React.FC<
    HistoryTabProps & { chats: UserLocalHistory['chat'][string][] }
> = ({
    IDE,
    webviewType,
    multipleWebviewsEnabled,
    setView,
    chats,
    searchQuery,
    onSearchQueryChange,
}) => {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [newTitle, setNewTitle] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    const { filteredChats, handleSearch } = useHistorySearch(chats, searchQuery)

    const chatByPeriod = useMemo(
        () =>
            Array.from(
                filteredChats.reverse().reduce((acc, chat) => {
                    const period = getRelativeChatPeriod(new Date(chat.lastInteractionTimestamp))
                    acc.set(period, [...(acc.get(period) || []), chat])
                    return acc
                }, new Map<string, SerializedChatTranscript[]>())
            ),
        [filteredChats]
    )
    const onDeleteButtonClick = useCallback(
        (id: string) => {
            if (chats.find(chat => chat.id === id)) {
                getVSCodeAPI().postMessage({
                    command: 'command',
                    id: 'cody.chat.history.clear',
                    arg: id,
                })
            }
        },
        [chats]
    )

    const handleStartNewChat = () => {
        getVSCodeAPI().postMessage({
            command: 'command',
            id: getCreateNewChatCommand({ IDE, webviewType, multipleWebviewsEnabled }),
        })
        setView(View.Chat)
    }
    const onEditButtonClick = useCallback(
        (id: string) => {
            setEditingId(id)
            const chat = chats.find(chat => chat.id === id)
            setNewTitle(chat?.chatTitle || '')
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus()
                }
            }, 0)
        },
        [chats]
    )

    const onSaveTitle = useCallback(
        (id: string, newTitle: string) => {
            // First update in local state
            const chat = chats.find(chat => chat.id === id)
            if (chat) {
                chat.chatTitle = newTitle
                // Send message to update in extension
                getVSCodeAPI().postMessage({
                    command: 'updateChatTitle',
                    chatID: id,
                    newTitle: newTitle,
                })
                setEditingId(null)
            }
        },
        [chats]
    )

    const SearchBar = memo(
        ({ value, onSearchSubmit }: { value: string; onSearchSubmit: (term: string) => void }) => {
            const [inputValue, setInputValue] = useState(value)

            useEffect(() => {
                setInputValue(value)
            }, [value])

            const handleReset = () => {
                setInputValue('')
                onSearchSubmit('') // Clear search by submitting empty term
            }

            const submitSearch = () => {
                onSearchSubmit(inputValue) // Submit current input value
            }

            return (
                <div className="tw-flex tw-gap-2">
                    <Input
                        type="text"
                        placeholder="Search in chat history..."
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submitSearch()}
                        className="tw-flex-1 tw-text-sm tw-text-muted-foreground [::placeholder:tw-text-sm] [::placeholder:tw-text-muted-foreground] tw-h-10"
                        variant="search"
                    />
                    {inputValue && (
                        <Button variant="secondary" onClick={handleReset} title="Clear search">
                            <XCircleIcon size={14} strokeWidth={1.25} />
                        </Button>
                    )}
                    <Button variant="secondary" onClick={submitSearch} title="Search">
                        <SearchIcon size={14} strokeWidth={1.25} />
                    </Button>
                </div>
            )
        }
    )

    return (
        <div className="tw-flex tw-flex-col tw-gap-6">
            <SearchBar
                value={searchQuery}
                onSearchSubmit={term => onSearchQueryChange(handleSearch(term))} // Update searchQuery in parent
            />
            {chatByPeriod.map(([period, chats]) => (
                <CollapsiblePanel
                    id={`history-${period}`.replaceAll(' ', '-').toLowerCase()}
                    key={period}
                    storageKey={`history.${period}`}
                    title={period}
                    initialOpen={true}
                >
                    {chats.map(({ interactions, id, chatTitle }) => {
                        const firstMessageOrTitle = chatTitle
                            ? chatTitle
                            : interactions[0]?.humanMessage?.text?.trim()

                        return (
                            <div key={id} className="tw-inline-flex tw-justify-between tw-mb-2">
                                {editingId === id ? (
                                    <div className="tw-flex tw-w-full tw-gap-2 tw-items-center">
                                        <Input
                                            ref={inputRef}
                                            type="text"
                                            value={newTitle}
                                            onChange={e => setNewTitle(e.target.value)}
                                            className="tw-flex-1 tw-rounded tw-border tw-h-10"
                                            variant="search"
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    onSaveTitle(id, newTitle)
                                                    setEditingId(null)
                                                } else if (e.key === 'Escape') {
                                                    setEditingId(null)
                                                }
                                            }}
                                        />
                                        <Button
                                            variant="secondary"
                                            onClick={() => onSaveTitle(id, newTitle)}
                                        >
                                            Save
                                        </Button>
                                        <Button variant="secondary" onClick={() => setEditingId(null)}>
                                            Cancel
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <Button
                                            variant="ghost"
                                            title={firstMessageOrTitle}
                                            onClick={() =>
                                                getVSCodeAPI().postMessage({
                                                    command: 'restoreHistory',
                                                    chatID: id,
                                                })
                                            }
                                            className="tw-text-left tw-truncate tw-w-full"
                                        >
                                            <MessageSquareTextIcon
                                                className="tw-w-8 tw-h-8 tw-opacity-80"
                                                size={16}
                                                strokeWidth="1.25"
                                            />
                                            <span className="tw-truncate tw-w-full">
                                                {firstMessageOrTitle}
                                            </span>
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            title="Edit chat title"
                                            onClick={() => onEditButtonClick(id)}
                                        >
                                            <PenIcon
                                                className="tw-w-8 tw-h-8 tw-opacity-80"
                                                size={16}
                                                strokeWidth="1.25"
                                            />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            title="Delete chat"
                                            onClick={() => onDeleteButtonClick(id)}
                                        >
                                            <TrashIcon
                                                className="tw-w-8 tw-h-8 tw-opacity-80"
                                                size={16}
                                                strokeWidth="1.25"
                                            />
                                        </Button>
                                    </>
                                )}
                            </div>
                        )
                    })}
                </CollapsiblePanel>
            ))}

            {filteredChats.length === 0 && (
                <div className="tw-flex tw-flex-col tw-items-center tw-mt-6">
                    <HistoryIcon
                        size={20}
                        strokeWidth={1.25}
                        className="tw-mb-5 tw-text-muted-foreground"
                    />

                    <span className="tw-text-lg tw-mb-4 tw-text-muted-foreground">
                        You have no chat history
                    </span>

                    <span className="tw-text-sm tw-text-muted-foreground tw-mb-8">
                        Explore all your previous chats here. Track and <br /> search through what you’ve
                        been working on.
                    </span>

                    <Button
                        size="sm"
                        variant="secondary"
                        aria-label="Start a new chat"
                        className="tw-px-4 tw-py-2"
                        onClick={handleStartNewChat}
                    >
                        <MessageSquarePlusIcon size={16} className="tw-w-8 tw-h-8" strokeWidth={1.25} />
                        Start a new chat
                    </Button>
                </div>
            )}
        </div>
    )
}

function useUserHistory(): LightweightChatHistory | UserLocalHistory | null | undefined {
    const userHistory = useExtensionAPI().userHistory
    return useObservable(useMemo(() => userHistory(ChatHistoryType.Full), [userHistory])).value
}

function useHistorySearch(chats: SerializedChatTranscript[], initialSearchTerm: string) {
    const activeSearchTerm = initialSearchTerm // Directly use the prop

    const filteredChats = useMemo(
        () =>
            filterChatsBySearch(
                chats.filter(chat => chat.interactions.length > 0),
                activeSearchTerm
            ),
        [chats, activeSearchTerm]
    )

    // handleSearch now just updates the external search term (passed via callback)
    const handleSearch = (term: string) => {
        return term // Return the term, the parent component will handle state update
    }

    return {
        filteredChats,
        handleSearch,
    }
}
