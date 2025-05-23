import findLast from 'lodash/findLast'

import {
    type ChatMessage,
    type ChatModel,
    type ContextItem,
    type MessagePart,
    type ModelContextWindow,
    type ProcessingStep,
    PromptString,
    type RankedContext,
    type SerializedChatInteraction,
    type SerializedChatTranscript,
    distinctUntilChanged,
    errorToChatError,
    modelsService,
    pendingOperation,
    ps,
    serializeChatMessage,
    startWith,
    switchMap,
    toRangeData,
} from '@sourcegraph/cody-shared'

import type { ImageData, MimeType } from '@sourcegraph/cody-shared/src/llm-providers/google'
import { Observable, Subject, map } from 'observable-fns'
import { getChatPanelTitle } from './chat-helpers'

/**
 * A builder for a chat thread. This is the canonical way to construct and mutate a chat thread.
 */
export class ChatBuilder {
    /**
     * Observe the context window for the {@link chat} thread's model (or the default chat model if
     * it has none).
     */
    public static contextWindowForChat(
        chat: ChatBuilder | Observable<ChatBuilder>
    ): Observable<ModelContextWindow | Error | typeof pendingOperation> {
        return ChatBuilder.resolvedModelForChat(chat).pipe(
            switchMap(
                (model): Observable<ModelContextWindow | Error | typeof pendingOperation> =>
                    model === pendingOperation
                        ? Observable.of(pendingOperation)
                        : model
                          ? modelsService.observeContextWindowByID(model)
                          : Observable.of(
                                new Error('No chat model is set, and no default chat model is available')
                            )
            )
        )
    }

    /**
     * Observe the resolved model for the {@link chat}, which is its selected model, or else the
     * default chat model if it has no selected model.
     */
    public static resolvedModelForChat(
        chat: ChatBuilder | Observable<ChatBuilder>
    ): Observable<ChatModel | undefined | typeof pendingOperation> {
        return (chat instanceof Observable ? chat : chat.changes).pipe(
            map(chat => chat.selectedModel),
            distinctUntilChanged(),
            switchMap(selectedModel =>
                selectedModel
                    ? modelsService.isModelAvailable(selectedModel).pipe(
                          switchMap(isModelAvailable => {
                              // Confirm that the user's explicitly selected model is available on the endpoint.
                              if (isModelAvailable) {
                                  return Observable.of(selectedModel)
                              }

                              // If the user's explicitly selected model is not available on the
                              // endpoint, clear it and use the default going forward. This should
                              // only happen if the server's model selection changes or if the user
                              // switches accounts with an open chat. Perhaps we could show some
                              // kind of indication to the user, but this is fine for now.
                              if (chat instanceof ChatBuilder) {
                                  chat.setSelectedModel(undefined)
                              }
                              return modelsService.getDefaultChatModel()
                          })
                      )
                    : modelsService.getDefaultChatModel()
            )
        )
    }

    private changeNotifications = new Subject<void>()
    constructor(
        /**
         * The model ID to use for the next assistant response if the user has explicitly chosen
         * one, or else `undefined` to use the default chat model on the current endpoint at the
         * time the chat is sent.
         */
        public selectedModel?: ChatModel | undefined,

        public readonly sessionID: string = new Date(Date.now()).toUTCString(),
        private messages: ChatMessage[] = [],
        private customChatTitle?: string,
        private images: ImageData[] = [],
        private isGoogleSearchEnabled = false
    ) {}

    /** An observable that emits whenever the {@link ChatBuilder}'s chat changes. */
    public changes: Observable<ChatBuilder> = this.changeNotifications.pipe(
        startWith(undefined),
        map(() => this)
    )

    /**
     * Set the selected model to use for the next assistant response, or `undefined` to use the
     * default chat model.
     */
    public setSelectedModel(newModelID: ChatModel | undefined): void {
        this.selectedModel = newModelID
        this.changeNotifications.next()
    }

    public isEmpty(): boolean {
        return this.messages.length === 0
    }

    public setLastMessageIntent(intent: ChatMessage['intent']): void {
        const lastMessage = this.messages.at(-1)
        if (!lastMessage) {
            throw new Error('no last message')
        }
        if (lastMessage.speaker !== 'human') {
            throw new Error('Cannot set intent for bot message')
        }

        lastMessage.intent = intent

        this.changeNotifications.next()
    }

    public setLastMessageContext(
        newContextUsed: ContextItem[],
        contextAlternatives?: RankedContext[]
    ): void {
        const lastMessage = this.messages.at(-1)
        if (!lastMessage) {
            throw new Error('no last message')
        }
        if (lastMessage.speaker !== 'human') {
            throw new Error('Cannot set new context used for bot message')
        }

        lastMessage.contextFiles = newContextUsed
        lastMessage.contextAlternatives = contextAlternatives?.map(({ items, strategy }) => {
            return {
                items: items,
                strategy,
            }
        })

        this.changeNotifications.next()
    }

    private setLastMessageContent(content: MessagePart[]): void {
        const lastMessage = this.messages.at(-1)
        if (!lastMessage) {
            throw new Error('no last message')
        }

        lastMessage.content = content
        this.changeNotifications.next()
    }

    public addHumanMessage(message: Omit<ChatMessage, 'speaker'>): void {
        if (this.messages.at(-1)?.speaker === 'human') {
            throw new Error('Cannot add a user message after a user message')
        }
        this.messages.push({ ...message, speaker: 'human' })
        this.changeNotifications.next()
    }

    /**
     * A special sentinel value for {@link ChatBuilder.addBotMessage} for when the assistant message
     * is not from any model. Only used in edge cases.
     */
    public static readonly NO_MODEL = Symbol('noChatModel')

    public addBotMessage(
        message: Omit<ChatMessage, 'speaker' | 'model' | 'error'>,
        model: ChatModel | typeof ChatBuilder.NO_MODEL
    ): void {
        const lastMessage = this.messages.at(-1)
        let error: any
        // If there is no text, it could be a placeholder message for an error
        if (lastMessage?.speaker === 'assistant') {
            if (lastMessage?.text) {
                throw new Error('Cannot add a bot message after a bot message')
            }
            error = this.messages.pop()?.error
        }
        this.messages.push({
            model: model === ChatBuilder.NO_MODEL ? undefined : model,
            ...message,
            speaker: 'assistant',
            error,
        })
        this.changeNotifications.next()
    }

    public addSearchResultAsBotMessage(search: ChatMessage['search']): void {
        const lastMessage = this.messages.at(-1)
        let error: any
        // If there is no text, it could be a placeholder message for an error
        if (lastMessage?.speaker === 'assistant') {
            if (lastMessage?.text) {
                throw new Error('Cannot add a bot message after a bot message')
            }
            error = this.messages.pop()?.error
        }
        this.messages.push({
            search,
            speaker: 'assistant',
            error,
            text: ps`Search found ${search?.response?.results.results.length || 0} results`,
        })
        this.changeNotifications.next()
    }

    public addErrorAsBotMessage(error: Error, model: ChatModel | typeof ChatBuilder.NO_MODEL): void {
        const lastMessage = this.messages.at(-1)
        // Remove the last assistant message if any
        const lastAssistantMessage: ChatMessage | undefined =
            lastMessage?.speaker === 'assistant' ? this.messages.pop() : undefined
        // Then add a new assistant message with error added
        this.messages.push({
            model: model === ChatBuilder.NO_MODEL ? undefined : model,
            ...(lastAssistantMessage ?? {}),
            speaker: 'assistant',
            error: errorToChatError(error),
        })
        this.changeNotifications.next()
    }

    public setLastMessageProcesses(processes: ProcessingStep[]): void {
        const lastMessage = this.messages.at(-1)
        if (!lastMessage) {
            throw new Error('no last message')
        }
        if (lastMessage.speaker !== 'human') {
            throw new Error('Cannot set processes for bot message')
        }
        lastMessage.processes = processes
        this.changeNotifications.next()
    }

    public getLastHumanMessage(): ChatMessage | undefined {
        return findLast(this.messages, message => message.speaker === 'human')
    }

    public getLastSpeakerMessageIndex(speaker: 'human' | 'assistant'): number | undefined {
        return this.messages.findLastIndex(message => message.speaker === speaker)
    }

    /**
     * Removes all messages from the given index when it matches the expected speaker.
     *
     * expectedSpeaker must match the speaker of the message at the given index.
     * This helps ensuring the intented messages are being removed.
     */
    public removeMessagesFromIndex(index: number, expectedSpeaker: 'human' | 'assistant'): void {
        if (this.isEmpty()) {
            throw new Error('ChatModel.removeMessagesFromIndex: not message to remove')
        }

        const speakerAtIndex = this.messages.at(index)?.speaker
        if (speakerAtIndex !== expectedSpeaker) {
            throw new Error(
                `ChatModel.removeMessagesFromIndex: expected ${expectedSpeaker}, got ${speakerAtIndex}`
            )
        }

        // Removes everything from the index to the last element
        this.messages.splice(index)
        this.changeNotifications.next()
    }

    public updateAssistantMessageAtIndex(index: number, update: Omit<ChatMessage, 'speaker'>): void {
        const message = this.messages.at(index)
        if (!message) {
            throw new Error('invalid index')
        }
        if (message.speaker !== 'assistant') {
            throw new Error('Cannot set selected filters for human message')
        }

        Object.assign(message, { ...update, speaker: 'assistant' })

        this.changeNotifications.next()
    }

    public getMessages(): readonly ChatMessage[] {
        return this.messages
    }

    // De-hydrate because vscode.Range serializes to `[start, end]` in JSON.
    // TODO: we should use a different type for `getMessages` to make the range hydration explicit.
    public getDehydratedMessages(): readonly ChatMessage[] {
        return this.messages.map(prepareChatMessage)
    }

    public getChatTitle(): string {
        if (this.customChatTitle) {
            return this.customChatTitle
        }
        const lastHumanMessage = this.getLastHumanMessage()
        return getChatPanelTitle(lastHumanMessage?.text?.toString() ?? '')
    }

    public setChatTitle(title: string): void {
        const firstHumanMessage = this.messages[0]
        if (firstHumanMessage?.speaker === 'human' && this.messages.length === 1) {
            this.customChatTitle = title
            this.changeNotifications.next()
        }
    }

    /**
     * Serializes to the transcript JSON format.
     */
    public toSerializedChatTranscript(): SerializedChatTranscript | undefined {
        const interactions: SerializedChatInteraction[] = []
        for (let i = 0; i < this.messages.length; i += 2) {
            const humanMessage = this.messages[i]
            if (humanMessage.error) {
                // Ignore chats that have errors, we don't need to serialize them
                return undefined
            }
            const assistantMessage = this.messages.at(i + 1)
            interactions.push(
                messageToSerializedChatInteraction(humanMessage, assistantMessage, this.messages)
            )
        }
        const result: SerializedChatTranscript = {
            id: this.sessionID,
            chatTitle: this.customChatTitle,
            lastInteractionTimestamp: this.sessionID,
            interactions,
        }
        return result
    }

    /**
     * Unified method to append any message part to any speaker.
     * Handles creating new messages or appending to existing ones.
     */
    public appendMessagePart(
        part: MessagePart,
        speaker: 'human' | 'assistant',
        model?: ChatModel
    ): void {
        const lastMessage = this.messages.at(-1)
        const isNewMessage = !lastMessage || lastMessage.speaker !== speaker

        const content = [part]
        const text = this.computeTextFromParts(content, speaker)

        if (isNewMessage) {
            // Create a new message for this part

            if (speaker === 'human') {
                this.addHumanMessage({ content, text })
            } else {
                this.addBotMessage({ content, text }, model || ChatBuilder.NO_MODEL)
            }
        } else {
            // Append to existing message
            const existingContent = lastMessage.content || []
            const updatedContent = [...existingContent, part]
            this.setLastMessageContent(updatedContent)
            // Update the text for the last message
            if (text) {
                lastMessage.text = text
            }
        }

        this.changeNotifications.next()
    }

    public replaceInMessage(index: number, search: PromptString, replacement: PromptString): boolean {
        const message = this.messages[index]
        if (!message) {
            return false
        }
        if (message.text?.includes(search)) {
            if (!replacement.endsWith('\n')) {
                // Our markdown parser needs the codeblock end fence at column 0.
                replacement = ps`${replacement}\n`
            }
            const updatedText = message.text?.replace(search, replacement)
            message.text = updatedText
            this.changeNotifications.next()
            return true
        }
        return false
    }

    /**
     * Intelligently combines text parts and tool results
     */
    private computeTextFromParts(parts: MessagePart[], speaker: 'human' | 'assistant'): PromptString {
        const textParts: string[] = []

        for (const part of parts) {
            if (part.type === 'text' && !!part.text) {
                textParts.push((part as { type: 'text'; text: string }).text)
            }
        }

        const joinedText = textParts.join('\n').trim()
        if (speaker === 'human') {
            return PromptString.unsafe_fromUserQuery(joinedText)
        }
        return PromptString.unsafe_fromLLMResponse(joinedText)
    }

    /**
     * Adds images to the `ChatBuilder`.
     *
     * @param imageUris - A string containing the base64-encoded image data.
     * @returns A `Promise` that resolves when the images have been added.
     */
    public async addImage(imageUri: string): Promise<void> {
        this.images = []
        if (imageUri === '') {
            return
        }
        this.images.push({
            data: imageUri,
            mimeType: this.detectMimeType(imageUri),
        })
    }

    /**
     * Retrieves and resets the images collected by the `ChatBuilder`.
     *
     * @returns The array of `ImageData` objects collected so far, or `undefined` if no images have been collected.
     */
    public getAndResetImages(): ImageData[] | undefined {
        const images = this.images
        this.images = []
        return images.length ? images : undefined
    }

    /**
     * Detects the MIME type of an image encoded in base64 format.
     *
     * @param base64String - The base64-encoded image data.
     * @returns The MIME type of the image, such as 'image/jpeg', 'image/png', or 'image/webp'. If the MIME type cannot be detected, it defaults to 'image/jpeg'.
     */
    private detectMimeType(base64String: string): MimeType {
        // Remove data URI prefix if present
        const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '')

        // Get first 10 bytes from base64
        const binaryStart = atob(base64Data).slice(0, 10)

        // Check magic numbers using charCodes
        if (binaryStart.charCodeAt(0) === 0xff && binaryStart.charCodeAt(1) === 0xd8) {
            return 'image/jpeg'
        }
        if (binaryStart.charCodeAt(0) === 0x89 && binaryStart.charCodeAt(1) === 0x50) {
            return 'image/png'
        }
        if (binaryStart.charCodeAt(8) === 0x57 && binaryStart.charCodeAt(9) === 0x45) {
            return 'image/webp'
        }

        // Default to jpeg if unknown
        return 'image/jpeg'
    }

    /**
     * Sets the Google search toggle to enabled.
     */
    public async setGoogleSearchToggle(): Promise<void> {
        this.isGoogleSearchEnabled = true
    }

    /**
     * Retrieves the current state of the Google search toggle and resets it to disabled.
     *
     * @returns The previous state of the Google search toggle, indicating whether it was enabled or disabled.
     */
    public getAndResetGoogleSearchToggle(): boolean {
        const isGoogleSearchEnabled = this.isGoogleSearchEnabled
        this.isGoogleSearchEnabled = false
        return isGoogleSearchEnabled
    }
}

function messageToSerializedChatInteraction(
    humanMessage: ChatMessage,
    assistantMessage: ChatMessage | undefined,
    messages: ChatMessage[]
): SerializedChatInteraction {
    if (humanMessage?.speaker !== 'human') {
        throw new Error(
            `expected human message, got bot. Messages: ${JSON.stringify(messages, null, 2)}`
        )
    }

    if (humanMessage.speaker !== 'human') {
        throw new Error(
            `expected human message to have speaker == 'human', got ${
                humanMessage.speaker
            }. Messages: ${JSON.stringify(messages, null, 2)}`
        )
    }
    if (assistantMessage && assistantMessage.speaker !== 'assistant') {
        throw new Error(
            `expected bot message to have speaker == 'assistant', got ${
                assistantMessage.speaker
            }. Messages: ${JSON.stringify(messages, null, 2)}`
        )
    }

    return {
        humanMessage: serializeChatMessage(humanMessage),
        assistantMessage: assistantMessage ? serializeChatMessage(assistantMessage) : null,
    }
}

export function prepareChatMessage(message: ChatMessage): ChatMessage {
    return {
        ...message,
        contextFiles: message.contextFiles?.map(dehydrateContextItem),
        contextAlternatives: message.contextAlternatives?.map(({ items, strategy }) => ({
            strategy,
            items: items.map(dehydrateContextItem),
        })),
    }
}

function dehydrateContextItem(item: ContextItem): ContextItem {
    return {
        ...item,
        // De-hydrate because vscode.Range serializes to `[start, end]` in JSON.
        range: toRangeData(item.range),
    }
}
