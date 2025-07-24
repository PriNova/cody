import { beforeEach, describe, expect, it } from 'vitest'
import type * as vscode from 'vscode'

import { AUTH_STATUS_FIXTURE_AUTHED, type UserLocalHistory } from '@sourcegraph/cody-shared'

import { localStorage } from './LocalStorageProvider'

describe('LocalStorageProvider', () => {
    // Set up local storage backed by an object.
    let localStorageData: { [key: string]: unknown } = {}
    localStorage.setStorage({
        get: (key: string) => localStorageData[key],
        update: (key: string, value: unknown) => {
            localStorageData[key] = value
            return Promise.resolve()
        },
    } as any as vscode.Memento)

    beforeEach(() => {
        localStorageData = {}
    })

    it('sets and gets chat history', async () => {
        await localStorage.setChatHistory(AUTH_STATUS_FIXTURE_AUTHED, {
            chat: { a: { id: 'a', lastInteractionTimestamp: '123', interactions: [] } },
        })

        const loadedHistory = localStorage.getChatHistory(AUTH_STATUS_FIXTURE_AUTHED)
        expect(loadedHistory).toEqual<UserLocalHistory>({
            chat: { a: { id: 'a', lastInteractionTimestamp: '123', interactions: [] } },
        })
    })

    it('sets and gets model preferences', async () => {
        // Test that model preferences can be stored and retrieved
        const testPreferences = {
            'https://sourcegraph.com/': {
                defaults: {
                    chat: 'anthropic::2023-06-01::claude-3-5-sonnet-20241022',
                    edit: 'openai::2024-02-01::gpt-4o',
                    autocomplete: 'fireworks::v1::starcoder-hybrid',
                },
                selected: {
                    chat: 'user-selected-chat-model',
                },
            },
        }

        await localStorage.setModelPreferences(testPreferences)
        const retrievedPreferences = localStorage.getModelPreferences()

        expect(retrievedPreferences).toEqual(testPreferences)
    })

    it('returns empty preferences when none are stored', () => {
        // Test that getModelPreferences returns empty object when nothing is stored
        const preferences = localStorage.getModelPreferences()
        expect(preferences).toEqual({})
    })
})
