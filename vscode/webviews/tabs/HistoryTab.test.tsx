import { CodyIDE } from '@sourcegraph/cody-shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AppWrapperForTest } from '../AppWrapperForTest'
import { HistoryTabWithData } from './HistoryTab'

describe('HistoryTabWithData', () => {
    const defaultProps = {
        IDE: CodyIDE.VSCode,
        setView: vi.fn(),
        searchQuery: '',
        onSearchQueryChange: vi.fn(),
    }

    test('renders empty state when there are no non-empty chats', () => {
        const emptyChats = [
            { id: '1', interactions: [], lastInteractionTimestamp: new Date().toISOString() },
        ]

        render(<HistoryTabWithData {...defaultProps} chats={emptyChats} />, {
            wrapper: AppWrapperForTest,
        })

        expect(screen.getByText(/no chat history/i)).toBeInTheDocument()
        expect(screen.getByText(/Start a new chat/i)).toBeInTheDocument()
    })

    test('search functionality works correctly', () => {
        const chats = [
            {
                id: '1',
                interactions: [
                    {
                        humanMessage: { text: 'test message', speaker: 'human' as const },
                        assistantMessage: { text: 'response', speaker: 'assistant' as const },
                    },
                ],
                lastInteractionTimestamp: new Date().toISOString(),
                chatTitle: '',
                speaker: 'human' as const,
            },
        ]

        render(<HistoryTabWithData {...defaultProps} chats={chats} />, {
            wrapper: AppWrapperForTest,
        })

        const searchInput = screen.getByPlaceholderText('Search in chat history...')
        fireEvent.change(searchInput, { target: { value: 'test' } })
        fireEvent.click(screen.getByTitle('Search'))

        expect(defaultProps.onSearchQueryChange).toHaveBeenCalledWith('test')
    })

    test('search can be cleared', () => {
        const chats = [
            {
                id: '1',
                interactions: [
                    {
                        humanMessage: { text: 'test message', speaker: 'human' as const },
                        assistantMessage: { text: 'response', speaker: 'assistant' as const },
                    },
                ],
                lastInteractionTimestamp: new Date().toISOString(),
                chatTitle: '',
                speaker: 'human' as const,
            },
        ]

        render(<HistoryTabWithData {...defaultProps} chats={chats} />, {
            wrapper: AppWrapperForTest,
        })

        fireEvent.click(screen.getByTitle('Clear search'))
        expect(defaultProps.onSearchQueryChange).toHaveBeenCalledWith('')
    })
})
