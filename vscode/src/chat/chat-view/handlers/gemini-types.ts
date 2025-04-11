/**
 * Type definitions for Gemini API function calling
 */

// Gemini function declaration format
export interface GeminiFunctionDeclaration {
    name: string
    description?: string
    parameters: {
        type: 'object'
        properties: Record<string, any>
        required?: string[]
    }
}

// Gemini function call format in responses
export interface GeminiFunctionCall {
    name: string
    id?: string
    args: Record<string, any>
}

// Gemini response with function calls
export interface GeminiResponseWithFunctionCalls {
    functionCalls?: GeminiFunctionCall[]
    text?: string
    content?: any[]
}
