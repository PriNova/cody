export interface Part {
    text: string
}
export interface GeminiCompletionResponse {
    candidates: {
        content: {
            parts: (Part | FunctionCall | FunctionResponse)[]
            role: string
        }
        finishReason: string
        groundingMetaData: any
        index: number
        safetyRatings: {
            category: string
            probability: string
        }[]
    }[]
}

export interface FunctionCall {
    type: 'functionCall'
    functionCall?: {
        id?: string
        name: string
        args?: any
    }
}

export interface FunctionResponse {
    type: 'functionResponse'
    functionResponse: {
        id?: string
        name: string
        response: any
    }
}

export interface ImageData {
    data: string
    mimeType: MimeType
}

export type MimeType = 'image/jpeg' | 'image/png' | 'image/webp'
export interface InlineDataPart {
    inline_data: {
        mime_type: MimeType
        data: string
    }
}

export interface GeminiChatMessage {
    role: string
    parts: (Part | InlineDataPart | FunctionCall | FunctionResponse)[]
}
