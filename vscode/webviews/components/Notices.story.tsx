import { CodyIDE } from '@sourcegraph/cody-shared'
import { ExtensionAPIProviderForTestsOnly, MOCK_API } from '@sourcegraph/prompt-editor'
import type { Meta, StoryObj } from '@storybook/react'

import { Notices } from './Notices'

const meta: Meta<typeof Notices> = {
    title: 'cody/Notices',
    component: props => (
        <ExtensionAPIProviderForTestsOnly value={MOCK_API}>
            <Notices {...props} />
        </ExtensionAPIProviderForTestsOnly>
    ),
    parameters: {
        layout: 'centered',
    },
}

export default meta

type Story = StoryObj<typeof Notices>

// Mock user data
const baseUser = {
    isDotComUser: true,
    isCodyProUser: false,
    user: {
        id: 'user-1',
        username: 'test-user',
        displayName: 'Test User',
        avatarURL: '',
        organizations: [],
        endpoint: 'https://example.com',
    },
    IDE: CodyIDE.VSCode,
}

export const SgTeammateNotice: Story = {
    args: {
        user: {
            ...baseUser,
            user: {
                ...baseUser.user,
                organizations: [
                    {
                        name: 'sourcegraph',
                        id: 'sourcegraph-01',
                    },
                ],
            },
        },
        instanceNotices: [],
    },
}

export const NoNotices: Story = {
    args: {
        user: {
            ...baseUser,
            isDotComUser: false,
        },
        instanceNotices: [],
    },
}

export const WebUserNoNotices: Story = {
    args: {
        user: {
            ...baseUser,
            IDE: CodyIDE.Web,
        },
        instanceNotices: [],
    },
}
