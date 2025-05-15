import type { Meta, StoryObj } from '@storybook/react'
import { VSCodeStandaloneComponent } from '../storybook/VSCodeStoryDecorator'
import { HistoryTabWithData } from './HistoryTab'

const meta: Meta<typeof HistoryTabWithData> = {
    title: 'cody/HistoryTab',
    component: HistoryTabWithData,
    decorators: [VSCodeStandaloneComponent],
    render: args => (
        <div style={{ position: 'relative', padding: '1rem' }}>
            <HistoryTabWithData {...args} />
        </div>
    ),
}

export default meta

type Story = StoryObj<typeof HistoryTabWithData>

export const Empty: Story = {
    args: {
        chats: [],
    },
}

export const SingleDay: Story = {
    args: {
        chats: [
            {
                id: '1',
                interactions: [
                    {
                        humanMessage: { speaker: 'human', text: 'How do I use React hooks?' },
                        assistantMessage: { speaker: 'assistant', text: 'Hello' },
                    },
                ],
                lastInteractionTimestamp: new Date().toISOString(),
            },
        ],
    },
}

export const MultiDay: Story = {
    args: {
        chats: [
            {
                id: '1',
                interactions: [
                    {
                        humanMessage: { speaker: 'human', text: 'How do I use React hooks?' },
                        assistantMessage: { speaker: 'assistant', text: 'Hello' },
                    },
                ],
                lastInteractionTimestamp: new Date(Date.now() - 86400000).toISOString(), // Yesterday
            },
            {
                id: '2',
                interactions: [
                    {
                        humanMessage: { speaker: 'human', text: 'Explain TypeScript interfaces' },
                        assistantMessage: { speaker: 'assistant', text: 'Hello' },
                    },
                ],
                lastInteractionTimestamp: new Date().toISOString(),
            },
        ],
    },
}

/* export const LazyLoaded: Story = {
    args: {
        IDE: CodyIDE.VSCode,
        setView: () => {},
        chats: getMockedChatData(50),
    },
}

function getMockedChatData(items: number): LightweightChatTranscript[] {
    const mockedChatData: LightweightChatTranscript[] = []

    for (let i = 3; i <= items; i++) {
        const lastTimestamp = Date.now() - Math.floor(Math.random() * 7) * 86400000 // Randomly within the last 7 days
        const firstHumanMessageText = `Question about topic ${i}-1`

        mockedChatData.push({
            id: String(i),
            chatTitle: `Chat about topic ${i}`,
            firstHumanMessageText,
            lastInteractionTimestamp: new Date(lastTimestamp).toISOString(),
        })
    }

    return mockedChatData
} */
