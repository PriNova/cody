import type { FunctionCall, FunctionResponse, GeminiChatMessage, InlineDataPart, Part } from '.'
import type { MimeType } from '.'
import { contextFiltersProvider } from '../../cody-ignore/context-filters-provider'
import { pendingOperation } from '../../misc/observableOperation'
import type { Model } from '../../models/model'
import { ModelTag } from '../../models/tags'
import type { Message } from '../../sourcegraph-api'

/**
 * Constructs an array of `GeminiChatMessage` objects from an array of `Message` objects.
 *
 * Each `GeminiChatMessage` object has a `role` property set to either `'user'` or `'model'` based on the `speaker` property of the
 * corresponding `Message` object, and a `parts` property containing an array with a single `{ text: string }` object, where the
 * `text` property is set to the `text` property of the corresponding `Message` object.
 *
 * The resulting array of `GeminiChatMessage` objects excludes the last `GeminiChatMessage` object if its `role` is `'model'`.
 *
 * @param messages - An array of `Message` objects to be converted to `GeminiChatMessage` objects.
 * @returns An array of `GeminiChatMessage` objects.
 */
export async function constructGeminiChatMessages(messages: Message[]): Promise<GeminiChatMessage[]> {
    const geminiMessages = await Promise.all(
        messages.map(async msg => ({
            role: msg.speaker === 'human' || msg.speaker === 'system' ? 'user' : 'model',
            parts: await Promise.all(
                (
                    msg.content || [
                        {
                            type: 'text',
                            text: (await msg.text?.toFilteredString(contextFiltersProvider)) || '',
                        },
                    ]
                ).map(async part => {
                    switch (part.type) {
                        case 'text':
                            return {
                                text:
                                    part.text ||
                                    (await msg.text?.toFilteredString(contextFiltersProvider)) ||
                                    '',
                            } as Part
                        case 'image_url': {
                            const base64Data = part.image_url.url.replace(/^data:image\/\w+;base64,/, '')
                            return {
                                inline_data: {
                                    mime_type: detectMimeType(base64Data),
                                    data: base64Data,
                                },
                            } as InlineDataPart
                        }
                        case 'inline_data': {
                            const base64Data = part.inline_data.data.replace(
                                /^data:image\/\w+;base64,/,
                                ''
                            )
                            return {
                                inline_data: {
                                    mime_type: detectMimeType(base64Data),
                                    data: base64Data,
                                },
                            } as InlineDataPart
                        }
                        case 'functionCall':
                            return {
                                functionCall: {
                                    id: part.functionCall.id,
                                    name: part.functionCall.name,
                                    args: parseToJson(part.functionCall?.args),
                                },
                            } as FunctionCall
                        case 'tool_call':
                            return {
                                functionCall: {
                                    id: part.tool_call.id,
                                    name: part.tool_call.name,
                                    args: part.tool_call.arguments,
                                },
                            } as unknown as FunctionCall
                        case 'tool_result':
                            return {
                                functionResponse: {
                                    id: part.tool_result.id,
                                    name: 'tool_result',
                                    response: parseToJson(part.tool_result.content),
                                },
                            } as FunctionResponse
                        case 'functionResponse': {
                            /*  console.log(
                                'googleUtils: response',
                                JSON.stringify(part.functionResponse.response, null, 2)
                            ) */
                            try {
                                return {
                                    functionResponse: {
                                        id: part.functionResponse.id,
                                        name: part.functionResponse.name,
                                        response: parseToJson(part.functionResponse.response),
                                    },
                                } as FunctionResponse
                            } catch (e) {
                                /* console.error(
                                    'googleUtils: Error parsing function response',
                                    JSON.stringify(e, null, 2)
                                ) */
                                return {
                                    functionResponse: {
                                        id: part.functionResponse.id,
                                        name: part.functionResponse.name,
                                        response: parseToJson('{}'),
                                    },
                                } as FunctionResponse
                            }
                        }
                        default:
                            return {
                                text: '',
                            } as Part
                    }
                })
            ),
        }))
    )

    if (geminiMessages.length >= 2) {
        geminiMessages.splice(0, 1)
        if (geminiMessages[0]?.role === 'model') {
            geminiMessages.splice(0, 1)
        }
    }

    return geminiMessages.filter((_, i, arr) => i !== arr.length - 1 || arr[i].role !== 'model')
}
export const isGeminiThinkingModel = (model: Model | undefined | typeof pendingOperation): boolean =>
    Boolean(
        model &&
            model !== pendingOperation &&
            model.tags.includes(ModelTag.BYOK) &&
            model.id.includes('2.5-flash')
    )

/**
 * Parses input into a consistent JSON object, handling various input types safely.
 *
 * @param input - The input to parse, which can be a string, object, undefined, or null
 * @returns A Record<string, unknown> representing the parsed input, with non-object inputs wrapped in a { value: ... } structure
 */
export function parseToJson(input: string | object | undefined | null): Record<string, unknown> {
    // Handle empty/null/undefined input
    if (input === undefined || input === null || input === '') {
        return {}
    }

    // Handle non-string objects directly
    // Check for array first, as typeof array === 'object'
    if (Array.isArray(input)) {
        // Wrap arrays passed directly to ensure an object is returned
        return { value: input } // Consistent wrapper key
    }
    if (typeof input === 'object') {
        // Assume non-array objects are already suitable
        return input as Record<string, unknown>
    }

    // Handle string input
    if (typeof input === 'string') {
        try {
            const parsedData = JSON.parse(input)

            // If the parsed data is a valid JSON object (but not null or an array), return it directly.
            if (typeof parsedData === 'object' && parsedData !== null && !Array.isArray(parsedData)) {
                return parsedData as Record<string, unknown>
            }

            // For anything else parsed (array, string, number, boolean, null), wrap it.
            return { value: parsedData } // Consistent wrapper key
        } catch (error: unknown) {
            // Parsing failed: Treat as a plain string and wrap it.
            return { value: input } // Consistent wrapper key
        }
    }

    // Fallback for unexpected primitive types (e.g., number, boolean directly passed if TS allows)
    // Wrap them too for consistency.
    return { value: input } // Consistent wrapper key
}

function detectMimeType(base64String: string): MimeType {
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
