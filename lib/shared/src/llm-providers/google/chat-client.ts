import type { GeminiChatMessage, GeminiCompletionResponse } from '.'
import type { ChatNetworkClientParams } from '..'
import {
    type Model,
    ModelUsage,
    contextFiltersProvider,
    firstValueFrom,
    getCompletionsModelConfig,
    logDebug,
    modelsService,
} from '../..'
import { onAbort } from '../../common/abortController'
import { CompletionStopReason } from '../../inferenceClient/misc'
import type { CompletionResponse } from '../../sourcegraph-api/completions/types'
import { constructGeminiChatMessages, isGeminiThinkingModel } from './utils'

/**
 * The URL for the Gemini API, which is used to interact with the Generative Language API provided by Google.
 * The `{model}` placeholder should be replaced with the specific model being used.
 */
const GEMINI_ALPHA_API_URL = 'https://generativelanguage.googleapis.com/v1alpha/models/{model}'
const GEMINI_BETA_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}'

/**
 * NOTE: Behind `chat.dev.models` configuration flag for internal dev testing purpose only!
 *
 * Calls the Google API for chat completions with history.
 * REF: https://ai.google.dev/tutorials/rest_quickstart#multi-turn_conversations_chat
 */
export async function googleChatClient({
    params,
    cb,
    completionsEndpoint,
    logger,
    signal,
}: ChatNetworkClientParams): Promise<void> {
    if (!params.model) {
        return
    }

    const config = getCompletionsModelConfig(params.model)
    if (!config?.key) {
        cb.onError(new Error(`API key must be provided to use Google Chat model ${params.model}`))
        return
    }

    const log = logger?.startCompletion(params, completionsEndpoint)
    const model =
        modelsService.getModelByID(params.model) ??
        (await firstValueFrom(modelsService.getDefaultModel(ModelUsage.Chat)))
    const isGeminiThinkModel = isGeminiThinkingModel(model)

    // Add the stream endpoint to the URL
    const apiEndpoint = isGeminiThinkModel
        ? new URL(GEMINI_ALPHA_API_URL.replace('{model}', config.model))
        : new URL(GEMINI_BETA_API_URL.replace('{model}', config.model))
    apiEndpoint.pathname += ':streamGenerateContent'
    apiEndpoint.searchParams.append('alt', 'sse')
    apiEndpoint.searchParams.append('key', config.key)

    const messages = await constructGeminiChatMessages(params.messages)
    let system_instruction: { parts: { text: string }[] } | undefined
    if (params.messages.length >= 3) {
        const firstMessage = params.messages[0]
        system_instruction = {
            parts: [
                {
                    text: (await firstMessage.text?.toFilteredString(contextFiltersProvider)) ?? '',
                },
            ],
        }
    }

    // Adds an inline image data part to the last user message in the `messages` array, if the `params.images` array has at least one element.
    if (params.images !== undefined) {
        const lastUserMessage = messages.at(-1) as GeminiChatMessage | undefined
        if (lastUserMessage?.role === 'user') {
            lastUserMessage.parts.push({
                inline_data: {
                    mime_type: params.images[0].mimeType,
                    data: params.images[0].data,
                },
            })
        }
    }
    const hasSearch =
        (model as Model).clientSideConfig?.options?.googleSearch && params.isGoogleSearchEnabled
    const tools = hasSearch ? [{ google_search: {} }] : []
    const configs = isGeminiThinkModel ? { thinkingConfig: { includeThoughts: true } } : {}

    const body = {
        contents: messages,
        ...(system_instruction ? { system_instruction } : {}),
        tools,
        generationConfig: configs,
    }

    // Sends the completion parameters and callbacks to the API.
    fetch(apiEndpoint, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json',
        },
        signal,
    })
        .then(async response => {
            if (!response.body) {
                throw new Error('No response body')
            }

            const reader = response.body.getReader()
            onAbort(signal, () => reader.cancel())

            const textDecoder = new TextDecoder()
            let responseText = ''
            let buffer = '' // Move buffer outside the loop

            // Handles the response stream to accumulate the full completion text.
            while (true) {
                if (!response.ok) {
                    let body: string | undefined
                    try {
                        body = textDecoder.decode((await reader.read()).value)
                    } catch (error) {
                        logDebug('googleChatClient', `error reading body: ${error}`)
                    }
                    logDebug(
                        'googleChatClient',
                        `HTTP ${response.status} Error: ${response.statusText}${
                            body ? ` — body: ${JSON.stringify(body)}` : ''
                        }`
                    )
                    throw new Error(`HTTP ${response.status} Error: ${response.statusText}`)
                }

                // Create a streaming json parser to handle this without reading the whole stream first
                const { done, value } = await reader.read()

                const decoded = textDecoder.decode(value, { stream: true })
                // Split the stream into individual messages
                const messages = decoded.split(/^data: /).filter(Boolean)
                for (const message of messages) {
                    // Remove the "data: " prefix from each message
                    const jsonString = message.replace(/^data: /, '').trim()

                    // Add to buffer and try to parse
                    buffer += jsonString
                    try {
                        const parsed = JSON.parse(buffer) as GeminiCompletionResponse
                        const streamText = parsed.candidates?.[0]?.content?.parts
                        if (streamText) {
                            if (isGeminiThinkModel) {
                                const prefixes = ['<think7345>', '</think7345>\n\n']
                                for (const part of parsed.candidates[0].content.parts) {
                                    if (part) {
                                        let prefix = ''
                                        if (part.thought && !responseText.includes(prefixes[0])) {
                                            prefix = prefixes[0]
                                        } else if (
                                            !part.thought &&
                                            !responseText.includes(prefixes[1])
                                        ) {
                                            prefix = prefixes[1]
                                        }

                                        const text = part.text
                                        const formattedText = prefix ? `${prefix}${text}` : text
                                        responseText += formattedText
                                        cb.onChange(responseText)
                                    }
                                }
                            } else {
                                const streamText = parsed.candidates?.[0]?.content?.parts[0]?.text
                                if (streamText) {
                                    responseText += streamText
                                    cb.onChange(responseText)
                                }
                            }
                        }
                        // Reset buffer after successful parse
                        buffer = ''
                    } catch (error) {
                        if (error instanceof SyntaxError) {
                            continue
                        }
                        console.error('Error parsing response:', error)
                        log?.onError(`Response parsing error: ${error}`)
                        break
                    }
                }

                if (done) {
                    cb.onComplete()
                    break
                }
            }

            const completionResponse: CompletionResponse = {
                completion: responseText,
                stopReason: CompletionStopReason.RequestFinished,
            }

            log?.onComplete(completionResponse)
        })
        .catch(error => {
            log?.onError(error)
            cb.onError(error)
        })
}
