import { Observable } from 'observable-fns'
import * as vscode from 'vscode'

import {
    type AuthStatus,
    type EditModel,
    FeatureFlag,
    PromptString,
    combineLatest,
    distinctUntilChanged,
    featureFlagProvider,
    firstValueFrom,
    isDotCom,
    isS2,
    skipPendingOperation,
    switchMap,
} from '@sourcegraph/cody-shared'
import { doesFileExist } from '../../commands/utils/workspace-files'
import { executePrefetchSmartApply, executeSmartApply } from '../../edit/smart-apply'
import { getEditor } from '../../editor/active-editor'
import type { VSCodeEditor } from '../../editor/vscode-editor'

import { SMART_APPLY_MODEL_IDENTIFIERS } from '../../edit/prompt/constants'
import { countCode, matchCodeSnippets } from './code-count'
import { resolveRelativeOrAbsoluteUri } from './edit-create-file'

const defaultLastStoredCode = {
    code: '',
    lineCount: 0,
    charCount: 0,
    eventName: '',
    source: '',
} satisfies LastStoredCode

type LastStoredCode = {
    code: string
    lineCount: number
    charCount: number
    eventName: string
    source: string
}

/**
 * It tracks the last stored code snippet and metadata like lines, chars, event, source etc.
 * This is used to track acceptance of generated code by Cody for Chat and Commands
 */
let lastStoredCode: LastStoredCode = { ...defaultLastStoredCode }
let insertInProgress = false

/**
 * Sets the last stored code snippet and associated metadata.
 *
 * This is used to track code generation events in VS Code.
 */
function setLastStoredCode({
    code,
    eventName,
}: {
    code: string
    eventName: 'copyButton' | 'keyDown.Copy' | 'applyButton' | 'insertButton' | 'saveButton'
}): void {
    // All non-copy events are considered as insertions since we don't need to listen for paste events
    const source = 'chat'
    insertInProgress = !eventName.toLowerCase().includes('copy')
    const { lineCount, charCount } = countCode(code)
    const codeCount = { code, lineCount, charCount, eventName, source }

    lastStoredCode = codeCount

    // 🚨 [Telemetry] if any new event names/types are added, check that those actions qualify as core events
    //(https://sourcegraph.notion.site/Cody-analytics-6b77a2cb2373466fae4797b6529a0e3d#2ca9035287854de48877a7cef2b3d4b4).
    // If not, the event recorded below this switch statement needs to be updated.
    switch (eventName) {
        case 'copyButton':
        case 'keyDown.Copy':
            break
        case 'applyButton':
            break
        case 'insertButton':
            break
        case 'saveButton':
            break
    }
}

/**
 * Handles insert event to insert text from code block at cursor position
 * Replace selection if there is one and then log insert event
 * Note: Using workspaceEdit instead of 'editor.action.insertSnippet' as the later reformats the text incorrectly
 */
export async function handleCodeFromInsertAtCursor(text: string): Promise<void> {
    const editor = getEditor()
    const activeEditor = editor.active
    const selection = activeEditor?.selection
    if (!activeEditor || !selection) {
        throw new Error('No editor or selection found to insert text')
    }

    const { document } = activeEditor
    const workspaceEdit = new vscode.WorkspaceEdit()

    // trimEnd() to remove new line added by Cody
    if (selection.isEmpty) {
        workspaceEdit.insert(document.uri, selection.start, text.trimEnd())
    } else {
        workspaceEdit.replace(document.uri, selection, text.trimEnd())
    }

    setLastStoredCode({ code: text, eventName: 'insertButton' })
    await vscode.workspace.applyEdit(workspaceEdit)
}

function isSmartApplyInstantModeEnabled(): Observable<boolean> {
    return combineLatest(
        featureFlagProvider.evaluatedFeatureFlag(FeatureFlag.CodySmartApplyInstantModeEnabled)
    ).pipe(
        switchMap(([isEnabled]) => {
            // If the instant mode is enabled, return true to use qwen model.
            if (isEnabled) {
                return Observable.of(true)
            }
            return Observable.of(false)
        }),
        distinctUntilChanged()
    )
}

async function getSmartApplyModel(authStatus: AuthStatus): Promise<EditModel | undefined> {
    const isInstantModeEnabled = await firstValueFrom(
        isSmartApplyInstantModeEnabled().pipe(skipPendingOperation())
    )
    if (isInstantModeEnabled) {
        return SMART_APPLY_MODEL_IDENTIFIERS.FireworksQwenCodeDefault
    }
    if (isDotCom(authStatus) || isS2(authStatus)) {
        const defaultModel: EditModel = 'anthropic::2024-10-22::claude-3-5-sonnet-latest'
        /**
         * For PLG, we have a greater model choice. We default this to Claude 3.5 Sonnet
         * as it is the most reliable model for smart apply from our testing.
         * We choose the model based on the feature flag but default to the sonnet model if the flag is not enabled or as default model.
         */
        return defaultModel
    }
    // We cannot be sure what model we're using for enterprise, we will let this fall through
    // to the default edit/smart apply behaviour where we use the configured enterprise model.
    return undefined
}

export async function handleSmartApply({
    id,
    code,
    authStatus,
    instruction,
    fileUri,
    traceparent,
    isPrefetch,
}: {
    id: string
    code: string
    authStatus: AuthStatus
    instruction?: string | null
    fileUri?: string | null
    traceparent?: string | undefined | null
    isPrefetch: boolean
}): Promise<void> {
    const activeEditor = getEditor()?.active
    const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri
    const uri = await resolveRelativeOrAbsoluteUri(workspaceUri, fileUri, activeEditor?.document?.uri)

    // TODO: move this logic to the smart apply manager
    const isNewFile = uri && !(await doesFileExist(uri))
    if (isNewFile) {
        if (isPrefetch) {
            return
        }

        const workspaceEditor = new vscode.WorkspaceEdit()
        workspaceEditor.createFile(uri, { ignoreIfExists: false })
        await vscode.workspace.applyEdit(workspaceEditor)
    }

    const document = uri ? await vscode.workspace.openTextDocument(uri) : activeEditor?.document
    if (!document) {
        throw new Error('No editor found to insert text')
    }

    if (isPrefetch) {
        executePrefetchSmartApply({
            configuration: {
                id,
                document,
                instruction: PromptString.unsafe_fromUserQuery(instruction || ''),
                model: await getSmartApplyModel(authStatus),
                replacement: code,
                isNewFile,
                traceparent,
            },
            source: 'chat',
        })

        return
    }

    const visibleEditor = vscode.window.visibleTextEditors.find(
        editor => editor.document.uri.toString() === document.uri.toString()
    )

    // Open the document for the user, so they can immediately see the progress decorations
    await vscode.window.showTextDocument(document, {
        // We may have triggered the smart apply from a different view column to the visible document
        // so re-use the correct view column if we can
        viewColumn: visibleEditor?.viewColumn,
    })

    setLastStoredCode({ code, eventName: 'applyButton' })
    await executeSmartApply({
        configuration: {
            id,
            document,
            instruction: PromptString.unsafe_fromUserQuery(instruction || ''),
            model: await getSmartApplyModel(authStatus),
            replacement: code,
            isNewFile,
            traceparent,
        },
        source: 'chat',
    })
}

/**
 * Handles insert event to insert text from code block to new file
 */
export async function handleCodeFromSaveToNewFile(text: string, editor: VSCodeEditor): Promise<void> {
    setLastStoredCode({ code: text, eventName: 'saveButton' })
    return editor.createWorkspaceFile(text)
}

/**
 * Handles copying code and detecting a paste event.
 */
export async function handleCopiedCode(text: string, eventType: string): Promise<void> {
    // If it's a Button event, then the text is already passed in from the whole code block
    const copiedCode = text ?? (await vscode.env.clipboard.readText())
    const eventName = eventType.toLowerCase().includes('button') ? 'copyButton' : 'keyDown.Copy'
    // Set for tracking
    if (copiedCode) {
        setLastStoredCode({ code: copiedCode, eventName })
    }
}

export async function isCodeFromChatCodeBlockAction(
    newCode: string
): Promise<({ operation: 'insert' | 'paste' } & LastStoredCode) | null> {
    const storedCode = { ...lastStoredCode }

    if (storedCode.code.length === 0) {
        return null
    }

    if (!matchCodeSnippets(storedCode.code, newCode)) {
        return null
    }

    if (insertInProgress) {
        lastStoredCode = { ...defaultLastStoredCode }
        insertInProgress = false
        return { ...storedCode, operation: 'insert' }
    }

    return { ...storedCode, operation: 'paste' }
}
