import { type Message, logDebug } from '@sourcegraph/cody-shared'
import { jsonrepair } from 'jsonrepair'
import type { z } from 'zod'
import { parseToolCallArgs } from './parse'

// Utility function to validate tool input
export function validateWithZod<T>(schema: z.ZodType<T>, input: unknown, toolName: string): T {
    const parsed = schema.safeParse(sanitizeToolInput(input))
    if (!parsed.success) {
        const errorMsg = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        logDebug('validateWithZod', `Validation error for ${toolName}: ${errorMsg}`)
        throw new Error(`${toolName} validation failed: ${errorMsg}`)
    }
    return parsed.data
}

export function sanitizeToolInput(input: unknown): string | unknown {
    // Only try to parse the input if it's a string that looks like JSON
    if (typeof input === 'string' && (input.startsWith('{') || input.startsWith('['))) {
        try {
            // First try standard parsing
            return JSON.parse(input)
        } catch (e) {
            // If standard parsing fails, try to repair it
            try {
                logDebug('sanitizeToolInput', `Attempting to repair malformed JSON: ${input}`)
                const repairedJson = jsonrepair(input)
                const result = JSON.parse(repairedJson)
                logDebug('sanitizeToolInput', `Successfully repaired JSON: ${repairedJson}`)
                return result
            } catch (repairError) {
                // If repair fails, continue with the original input
                logDebug('sanitizeToolInput', `Failed to repair JSON: ${input}`)
            }
        }
    }
    // Return the original input if it's not a string starting with { or [
    // or if all parsing attempts failed
    return input
}

/**
 * Workaround function to create a new prompt array where empty string arguments
 * in tool calls are replaced with a JSON representation of an empty object ("{}").
 * This is necessary to prevent API errors from providers that fail to parse
 * empty strings as valid JSON for tool arguments.
 * This function follows immutability principles.
 *
 * @param originalPrompt - The original array of Message objects.
 * @returns A new prompt array with potentially modified tool call arguments.
 */
export function fixEmptyToolArgumentsInPrompt(originalPrompt: readonly Message[]): Message[] {
    // Use map to create a new top-level array
    return originalPrompt.map(message => {
        // Check if content needs modification
        if (message.content && Array.isArray(message.content)) {
            let contentModified = false
            // Use map to create a new content array
            const newContent = message.content.map(part => {
                if (part.type === 'functionCall') {
                    contentModified = true
                    // Return a *new* part object with modified arguments
                    if (part.functionCall?.args === '') {
                        return {
                            ...part, // Copy other properties
                            functionCall: {
                                ...part.functionCall, // Copy other tool_call properties
                                args: '{}', // Modify arguments
                            },
                        }
                    }
                    if (typeof part.functionCall?.args === 'object') {
                        return {
                            ...part, // Copy other properties
                            functionCall: {
                                ...part.functionCall, // Copy other tool_call properties
                                args: String(parseToolCallArgs(part.functionCall?.args)), // Modify arguments
                            },
                        }
                    }
                    return part
                }
                if (part.type === 'tool_call' && part.tool_call?.arguments === '') {
                    contentModified = true
                    // Return a *new* part object with modified arguments
                    return {
                        ...part, // Copy other properties
                        tool_call: {
                            ...part.tool_call, // Copy other tool_call properties
                            arguments: '{}', // Modify arguments
                        },
                    }
                }
                // Return the original part if no modification needed
                return part
            })

            // If content was modified, return a new message object with the new content
            if (contentModified) {
                return {
                    ...message, // Copy other message properties
                    content: newContent, // Use the new content array
                }
            }
        }
        // Return the original message if no modification needed
        return message
    })
}
