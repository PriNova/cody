import type { Tool } from '@anthropic-ai/sdk/resources'
import type { z } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'

// Function to convert Zod schema to Anthropic-compatible InputSchema
export function zodToolSchema(schema: z.ZodObject<any>): Tool.InputSchema {
    return zodToJsonSchema(schema) as Tool.InputSchema
}

export function parseToolCallArgs(argsString: string | undefined | null): Record<string, unknown> {
    // Handle null, undefined, or empty string explicitly
    if (!argsString) {
        return {}
    }

    try {
        // Attempt to parse the string as JSON
        if (typeof argsString === 'object') {
            return argsString
        }
        const parsed = JSON.parse(argsString)

        // Ensure the parsed result is actually an object
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>
        }
        // If parsing succeeds but doesn't yield an object (e.g., parsing "true" or "123")
        return {}
    } catch (error) {
        // Handle cases where JSON parsing fails (invalid JSON)
        return {} // Return an empty object on any parsing failure
    }
}
