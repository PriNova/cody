import clsx from 'clsx'
import { type FC, useCallback, useMemo, useState } from 'react'

import type { Action, PromptsInput } from '@sourcegraph/cody-shared'

import { useLocalStorage } from '../../components/hooks'

import { useConfig } from '../../utils/useConfig'
import { useDebounce } from '../../utils/useDebounce'
import {
    Command,
    CommandInput,
    CommandList,
    CommandLoading,
    CommandSeparator,
} from '../shadcn/ui/command'
import { ActionItem } from './ActionItem'
import styles from './PromptList.module.css'
import { usePromptsQuery } from './usePromptsQuery'
import { commandRowValue } from './utils'

export interface PromptsFilterArgs {
    owner?: string
    tags?: string[]
    promoted?: boolean
    core?: boolean
}
interface PromptListProps {
    showSearch: boolean
    showFirstNItems?: number
    telemetryLocation: 'PromptSelectField' | 'WelcomeAreaPrompts'
    showOnlyPromptInsertableCommands?: boolean
    showCommandOrigins?: boolean
    showPromptLibraryUnsupportedMessage?: boolean
    className?: string
    inputClassName?: string
    paddingLevels?: 'none' | 'middle' | 'big'
    appearanceMode?: 'flat-list' | 'chips-list'
    lastUsedSorting?: boolean
    recommendedOnly?: boolean
    onSelect: (item: Action) => void
    promptFilters?: PromptsFilterArgs
}

/**
 * A list of prompts from the Prompt Library. For backcompat, it also displays built-in commands and
 * custom commands (which are both deprecated in favor of the Prompt Library).
 *
 * It is used in the {@link PromptSelectField} in a popover and in the welcome area.
 */
export const PromptList: FC<PromptListProps> = props => {
    const {
        showSearch,
        showFirstNItems,

        showOnlyPromptInsertableCommands,
        showPromptLibraryUnsupportedMessage = true,
        className,
        inputClassName,
        paddingLevels = 'none',
        appearanceMode = 'flat-list',
        lastUsedSorting,
        recommendedOnly,
        onSelect: parentOnSelect,
        promptFilters,
    } = props
    const { clientCapabilities, authStatus } = useConfig()
    const endpointURL = new URL(authStatus.endpoint)

    const [lastUsedActions = {}] = useLocalStorage<Record<string, number>>('last-used-actions-v2', {})

    const [query, setQuery] = useState('')
    const debouncedQuery = useDebounce(query, 250)

    const promptInput = useMemo<PromptsInput>(
        () => ({
            query: debouncedQuery,
            first: showFirstNItems,
            recommendedOnly: promptFilters?.promoted ?? recommendedOnly ?? false,
            builtinOnly: promptFilters?.core ?? false,
            tags: promptFilters?.tags,
            owner: promptFilters?.owner,
        }),
        [debouncedQuery, showFirstNItems, recommendedOnly, promptFilters]
    )

    const { value: result, error } = usePromptsQuery(promptInput)

    const onSelect = useCallback(
        (rowValue: string): void => {
            const action = result?.actions.find(p => commandRowValue(p) === rowValue)

            if (!action || !result) {
                return
            }

            parentOnSelect(action)
        },
        [result, parentOnSelect]
    )

    const filteredActions = useCallback(
        (actions: Action[]) => {
            if (promptFilters?.core) {
                return actions.filter(action => action.actionType === 'prompt' && action.builtin)
            }

            const shouldExcludeBuiltinCommands =
                promptFilters?.promoted || promptFilters?.owner || promptFilters?.tags

            const isEditEnabled = clientCapabilities.edit === 'enabled'
            // Prompts that perform edits are not usable on clients that don't support editing.
            // To avoid cluttering the list with unusable prompts we ignore them completely.
            if (!isEditEnabled) {
                actions = actions.filter(action =>
                    action.actionType === 'prompt' ? action.mode === 'CHAT' : action.mode === 'ask'
                )
            }
            if (shouldExcludeBuiltinCommands) {
                return actions.filter(action => action.actionType === 'prompt' && !action.builtin)
            }

            return actions
        },
        [promptFilters, clientCapabilities.edit]
    )

    // Don't show builtin commands to insert in the prompt editor.
    const allActions = showOnlyPromptInsertableCommands
        ? result?.actions.filter(action => action.actionType === 'prompt' || action.mode === 'ask') ?? []
        : result?.actions ?? []

    const sortedActions = lastUsedSorting
        ? getSortedActions(filteredActions(allActions), lastUsedActions)
        : filteredActions(allActions)
    const actions = showFirstNItems ? sortedActions.slice(0, showFirstNItems) : sortedActions

    const inputPaddingClass =
        paddingLevels !== 'none' ? (paddingLevels === 'middle' ? '!tw-p-0' : '!tw-p-2') : ''

    const itemPaddingClass =
        paddingLevels !== 'none' ? (paddingLevels === 'middle' ? '!tw-px-6' : '!tw-px-8') : ''

    const anyPromptFilterActive = !!Object.keys(promptFilters ?? {}).length
    return (
        <Command
            loop={true}
            tabIndex={0}
            shouldFilter={false}
            defaultValue="xxx-no-item"
            className={clsx(className, styles.list, {
                [styles.listChips]: appearanceMode === 'chips-list',
            })}
            disablePointerSelection={true}
        >
            <CommandList className={className}>
                {showSearch && (
                    <div className={clsx(inputPaddingClass, inputClassName, styles.listInputContainer)}>
                        <CommandInput
                            value={query}
                            onValueChange={setQuery}
                            placeholder="Search..."
                            autoFocus={true}
                            className={styles.listInput}
                        />
                    </div>
                )}

                {!result && !error && (
                    <CommandLoading className={itemPaddingClass}>Loading...</CommandLoading>
                )}
                {!recommendedOnly &&
                    result &&
                    result.arePromptsSupported &&
                    sortedActions.filter(action => action.actionType === 'prompt').length === 0 && (
                        <CommandLoading className={itemPaddingClass}>
                            {result?.query === '' && !anyPromptFilterActive ? (
                                <>
                                    Your Prompt Library is empty.{' '}
                                    <a
                                        href={new URL('/prompts/new', endpointURL).toString()}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Add a prompt
                                    </a>{' '}
                                    to reuse and share it.
                                </>
                            ) : (
                                <>No prompts found</>
                            )}
                        </CommandLoading>
                    )}
                {actions.map(action => (
                    <ActionItem
                        key={commandRowValue(action)}
                        action={action}
                        onSelect={onSelect}
                        className={clsx(itemPaddingClass, styles.listItem)}
                    />
                ))}
                {showPromptLibraryUnsupportedMessage && result && !result.arePromptsSupported && (
                    <>
                        <CommandSeparator alwaysRender={true} />
                        <CommandLoading className="tw-px-4">
                            Prompt Library is not yet available on {endpointURL.hostname}. Ask your site
                            admin to upgrade to Sourcegraph 5.6 or later.
                        </CommandLoading>
                    </>
                )}

                {error && (
                    <CommandLoading className="tw-px-4">
                        Error: {error.message || 'unknown'}
                    </CommandLoading>
                )}
            </CommandList>
        </Command>
    )
}

function getSortedActions(actions: Action[], lastUsedActions: Record<string, number>): Action[] {
    return [...actions].sort((action1, action2) => {
        const action1Key = action1.actionType === 'prompt' ? action1.id : action1.key
        const action2Key = action2.actionType === 'prompt' ? action2.id : action2.key
        const action1Count = lastUsedActions[action1Key] ?? 0
        const action2Count = lastUsedActions[action2Key] ?? 0

        return action2Count - action1Count
    })
}
