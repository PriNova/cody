import type { Span } from '@opentelemetry/api'
import {
    type ChatMessage,
    type ContextItem,
    type Message,
    type MessagePart,
    type Model,
    PromptString,
    type ToolCallContentPart,
    type ToolResultContentPart,
    UIToolStatus,
    isDefined,
    logDebug,
    modelsService,
} from '@sourcegraph/cody-shared'
import type { ContextItemToolState } from '@sourcegraph/cody-shared/src/codebase-context/messages'
import { URI } from 'vscode-uri'
import { PromptBuilder } from '../../../prompt-builder'
import type { ChatBuilder } from '../ChatBuilder'
import type { ChatControllerOptions } from '../ChatController'
import type { ContextRetriever } from '../ContextRetriever'
import { type AgentTool, AgentToolGroup } from '../tools'
import { fixEmptyToolArgumentsInPrompt } from '../utils/input'
import { parseToolCallArgs } from '../utils/parse'
import { ChatHandler } from './ChatHandler'
import type { AgentHandler, AgentHandlerDelegate, AgentRequest } from './interfaces'
import { buildAgentPrompt } from './prompts'

interface ToolResult {
    output: ContextItemToolState
    tool_result: ToolResultContentPart
}

// Define the TypeScript type for a cleaned schema object, reflecting the supported Gemini fields.
// This will be used recursively.
interface GeminiParameterSchema {
    type?: string // Maps to Gemini's Type enum values like 'STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT', 'NULL'
    format?: string
    title?: string
    description?: string
    nullable?: boolean
    enum?: (string | number | boolean | null)[]
    maxItems?: string // As per Gemini spec, should be string (int64 format)
    minItems?: string // As per Gemini spec, should be string (int64 format)
    properties?: Record<string, GeminiParameterSchema> // Recursive definition for object properties
    required?: string[] // For object types, lists names of required properties
    anyOf?: GeminiParameterSchema[] // Recursive definition for anyOf
    items?: GeminiParameterSchema // Recursive definition for array items
    minimum?: number // For number/integer types
    maximum?: number // For number/integer types
    // Note: propertyOrdering is listed but often not required for basic schema definition, omitting for simplicity unless needed.
}

// Define the TypeScript types for the overall Gemini tool structure
interface GeminiFunctionDeclaration {
    name: string
    description?: string // Description can be optional
    // Parameters object structure expected by Gemini - this *is* a Schema object itself with type 'object'
    parameters: {
        type: 'object'
        properties?: Record<string, GeminiParameterSchema> // Top-level parameters are defined here using our cleaned schema type
        required?: string[] // Required names of the top-level properties listed in 'properties'
    }
}

// This interface represents the single wrapper object expected by the Gemini API's 'tools' parameter
interface GeminiToolWrapper {
    functionDeclarations: GeminiFunctionDeclaration[]
}

// The final output type for the 'tools' parameter is an array containing one wrapper object.
type GeminiToolsParam = GeminiToolWrapper[]

/**
 * Base AgenticHandler class that manages tool execution state
 * and implements the core agentic conversation loop when Agent Mode is enabled.
 */
export class GeminiAgenticHandler extends ChatHandler implements AgentHandler {
    public static readonly id = 'agentic-chat'
    protected readonly SYSTEM_PROMPT: PromptString
    protected readonly MAX_TURN = 50

    private maxRequestsPerMinute = 10 // 10 requests per minute
    private delayBetweenRequests = 6000 // 6000ms
    private lastRequestTime = 0

    protected tools: AgentTool[] = []
    //protected model: Model = undefined

    constructor(
        contextRetriever: Pick<ContextRetriever, 'retrieveContext' | 'computeDidYouMean'>,
        editor: ChatControllerOptions['editor'],
        protected readonly chatClient: ChatControllerOptions['chatClient'],
        protected readonly agentModel: string
    ) {
        super(contextRetriever, editor, chatClient)
        this.SYSTEM_PROMPT = PromptString.unsafe_fromUserQuery(buildAgentPrompt())
    }

    public async handle(req: AgentRequest, delegate: AgentHandlerDelegate): Promise<void> {
        const { requestID, chatBuilder, inputText, editorState, span, recorder, signal, mentions } = req
        const sessionID = chatBuilder.sessionID

        const model = modelsService.getModelByID(this.agentModel) as Model
        this.maxRequestsPerMinute = model.clientSideConfig?.options?.RPM || 10
        this.delayBetweenRequests = (60 * 1000) / this.maxRequestsPerMinute

        // Includes initial context mentioned by user
        const contextResult = await this.computeContext(
            requestID,
            { text: inputText, mentions },
            editorState,
            chatBuilder,
            delegate,
            signal
        )
        const contextItems = contextResult?.contextItems ?? []

        // Initialize available tools
        this.tools = await AgentToolGroup.getToolsByAgentId(this.contextRetriever, span)

        const startTime = Date.now()

        logDebug('AgenticHandler', `Starting agent session ${sessionID}`)

        recorder.recordChatQuestionExecuted(contextItems, { addMetadata: true, current: span })
        try {
            // Run the main conversation loop
            await this.runConversationLoop(chatBuilder, delegate, recorder, span, signal, contextItems)
        } catch (error) {
            this.handleError(sessionID, error, delegate, signal)
        } finally {
            delegate.postDone()
            logDebug('AgenticHandler', `Ending agent session ${sessionID}`)
            logDebug('AgenticHandler', `Session ${sessionID} duration: ${Date.now() - startTime}ms`)
        }
    }

    /**
     * Enforces a delay between consecutive requests to prevent rate limiting.
     * Calculates the time since the last request and waits if necessary to maintain
     * the specified minimum delay between requests.
     */
    private async enforceRequestSpacing(): Promise<void> {
        const now = Date.now()

        if (this.lastRequestTime !== 0) {
            const timeSinceLastRequest = now - this.lastRequestTime

            if (timeSinceLastRequest < this.delayBetweenRequests) {
                const waitTime = this.delayBetweenRequests - timeSinceLastRequest
                await new Promise(resolve => setTimeout(resolve, waitTime))
            }
        }

        this.lastRequestTime = Date.now()
    }

    /**
     * Run the main conversation loop, processing LLM responses and executing tools
     */
    protected async runConversationLoop(
        chatBuilder: ChatBuilder,
        delegate: AgentHandlerDelegate,
        recorder: AgentRequest['recorder'],
        span: Span,
        parentSignal: AbortSignal,
        contextItems: ContextItem[] = []
    ): Promise<void> {
        let turnCount = 0

        const loopController = new AbortController()
        const signal = loopController.signal

        parentSignal.addEventListener('abort', () => {
            loopController.abort()
        })

        // Main conversation loop
        while (turnCount < this.MAX_TURN && !loopController.signal?.aborted) {
            try {
                // Get LLM response
                const { botResponse, toolCalls } = await this.requestLLM(
                    chatBuilder,
                    delegate,
                    recorder,
                    span,
                    signal,
                    this.agentModel,
                    contextItems
                )

                // No tool calls means we're done
                if (!toolCalls?.size) {
                    chatBuilder.addBotMessage(botResponse, this.agentModel)
                    logDebug('AgenticHandler', 'No tool calls, ending conversation')
                    break
                }

                // Execute tools and update results
                const content = Array.from(toolCalls.values())
                //console.log('Tool call content arguments:', JSON.stringify(content, null, 2))
                delegate.postMessageInProgress(botResponse)

                const results = await this.executeTools(content, this.agentModel).catch(() => {
                    logDebug('AgenticHandler', 'Error executing tools')
                    return []
                })

                //console.log('Tool call results:', JSON.stringify(results, null, 2))

                const toolResults = results?.map(result => result.tool_result).filter(isDefined)
                const toolOutputs = results?.map(result => result.output).filter(isDefined)

                const textOnlyParts = toolResults.flatMap(result => {
                    const parts = JSON.parse(result.tool_result.content) as MessagePart[]
                    return parts.filter(part => part.type === 'text')
                })

                botResponse.contextFiles = toolOutputs
                botResponse.content = [
                    ...content, // Include the tool calls
                    ...textOnlyParts,
                ]

                delegate.postMessageInProgress(botResponse)

                chatBuilder.addBotMessage(botResponse, this.agentModel)

                const messageParts = toolResults.flatMap(result => {
                    const parts = JSON.parse(result.tool_result.content) as MessagePart[]
                    return parts
                })

                // Add a human message to hold tool results
                chatBuilder.addHumanMessage({
                    content: [...messageParts, ...toolResults],
                    intent: 'agentic',
                    contextFiles: toolOutputs,
                })

                // Exit if max turns reached
                if (turnCount >= this.MAX_TURN - 1) {
                    logDebug('AgenticHandler', 'Max turns reached, ending conversation')
                    break
                }

                turnCount++
            } catch (error) {
                this.handleError(chatBuilder.sessionID, error, delegate, signal)
                break
            }
        }
    }

    /**
     * Request a response from the LLM with tool calling capabilities
     */
    protected async requestLLM(
        chatBuilder: ChatBuilder,
        delegate: AgentHandlerDelegate,
        recorder: AgentRequest['recorder'],
        span: Span,
        signal: AbortSignal,
        model: string,
        contextItems: ContextItem[]
    ): Promise<{ botResponse: ChatMessage; toolCalls: Map<string, ToolCallContentPart> }> {
        // Fixed spacing enforcement between requests
        await this.enforceRequestSpacing()

        // Create prompt
        const prompter = new AgenticChatPrompter(this.SYSTEM_PROMPT)
        const prompt = await prompter.makePrompt(chatBuilder, contextItems)

        // WORKAROUND: Fix empty string arguments in the final prompt before sending to API
        const fixedPrompt = fixEmptyToolArgumentsInPrompt(prompt)

        // No longer recording chat question executed telemetry in agentic handlers
        // This is now only done when user submits a query
        // Prepare API call parameters
        const params = {
            maxTokensToSample: 8000,
            messages: JSON.stringify(fixedPrompt),
            // Format tools according to Gemini function calling specification
            // Use the helper function to convert available tools
            tools: convertAnthropicToolsToGeminiTools({
                tools: this.tools.filter(tool => !tool.disabled),
            }),
            stream: true,
            model,
        }

        // Initialize state
        const toolCalls = new Map<string, ToolCallContentPart>()
        const streamed: MessagePart = { type: 'text', text: '' }
        const content: MessagePart[] = []

        // Process stream
        const stream = await this.chatClient.chat(fixedPrompt, params, signal)
        for await (const message of stream) {
            if (signal.aborted) break

            switch (message.type) {
                case 'change': {
                    streamed.text = message.text
                    delegate.postMessageInProgress({
                        speaker: 'assistant',
                        content: [streamed],
                        text: PromptString.unsafe_fromLLMResponse(streamed.text),
                        model,
                    })
                    // Process tool calls in the response
                    const toolCalledParts = message?.content?.filter(c => c.type === 'tool_call') || []
                    for (const toolCall of toolCalledParts) {
                        this.syncToolCall(toolCall, toolCalls)
                    }
                    break
                }
                case 'error': {
                    throw message.error
                }
                case 'complete': {
                    content.push(streamed)
                    break
                }
            }
        }

        // Create final response
        if (toolCalls.size > 0) {
            content.push(...Array.from(toolCalls.values()))
        }

        // Create contextFiles for each tool call
        const contextFiles: ContextItemToolState[] = Array.from(toolCalls.values()).map(toolCall => ({
            uri: URI.parse(''),
            type: 'tool-state',
            content: toolCall.tool_call.arguments,
            toolId: toolCall.tool_call.id,
            toolName: toolCall.tool_call.name,
            status: UIToolStatus.Pending,
            outputType: 'status',
        }))

        return {
            botResponse: {
                speaker: 'assistant',
                intent: 'agentic',
                content,
                model,
                text: streamed.text ? PromptString.unsafe_fromLLMResponse(streamed.text) : undefined,
                contextFiles, // Add contextFiles to the bot response
            },
            toolCalls,
        }
    }

    /**
     * Process and sync tool calls
     */
    protected syncToolCall(
        toolCall: ToolCallContentPart,
        toolCalls: Map<string, ToolCallContentPart>
    ): void {
        // Get the existing call *before* potentially modifying the incoming toolCall chunk
        const existingCall = toolCalls.get(toolCall?.tool_call?.id)
        if (!existingCall) {
            console.log('AgenticHandler', `Calling ${toolCall?.tool_call?.name}`, { verbose: toolCall })
        }
        // Merge the existing call (if any) with the new toolCall,
        // prioritizing properties from the new toolCall.  This ensures
        // that status and result are preserved if they exist.
        const updatedCall = { ...existingCall, ...toolCall }
        toolCalls.set(toolCall?.tool_call?.id, updatedCall)
    }

    /**
     * Execute tools from LLM response
     */
    protected async executeTools(
        toolCalls: ToolCallContentPart[],
        model: string
    ): Promise<ToolResult[]> {
        try {
            logDebug('AgenticHandler', `Executing ${toolCalls.length} tools`)
            // Execute all tools concurrently and filter out any undefined/null results
            const results = await Promise.allSettled(
                toolCalls.map(async toolCall => {
                    try {
                        logDebug('AgenticHandler', `Executing ${toolCall.tool_call?.name}`, {
                            verbose: toolCall,
                        })
                        return await this.executeSingleTool(toolCall, model)
                    } catch (error) {
                        console.log(
                            'AgenticHandler',
                            `Error executing tool ${toolCall.tool_call.name}`,
                            {
                                verbose: error,
                            }
                        )
                        return null // Return null for failed tool executions
                    }
                })
            )
            // Filter out rejected promises and null/undefined results
            return results
                .filter(result => result.status === 'fulfilled' && result.value)
                .map(result => (result as PromiseFulfilledResult<ToolResult>).value)
        } catch (error) {
            logDebug('AgenticHandler', 'Error executing tools', { verbose: error })
            return []
        }
    }

    /**
     * Execute a single tool and handle success/failure
     */
    protected async executeSingleTool(
        toolCall: ToolCallContentPart,
        model: string
    ): Promise<ToolResult | undefined | null> {
        // Find the appropriate tool
        const enabledTools = this.tools.filter(tool => !tool.disabled)
        const tool = enabledTools.find(t => t.spec.name === toolCall.tool_call.name)
        if (!tool) return undefined

        const tool_result: ToolResultContentPart = {
            type: 'tool_result',
            tool_result: {
                id: toolCall.tool_call.id,
                content: '',
            },
        }

        const tool_item = {
            toolId: toolCall.tool_call.id,
            toolName: toolCall.tool_call.name,
            status: UIToolStatus.Done,
        }

        try {
            const args = parseToolCallArgs(toolCall.tool_call.arguments)
            logDebug('AgenticHandler', 'Tool call arguments:', JSON.stringify(args, null, 2))
            const results = await tool.invoke(args)
            logDebug(
                'AgenticHandler',
                `Tool ${toolCall.tool_call.name} executed successfully`,
                JSON.stringify(results, null, 2)
            )

            // Convert the results into MessagePart array
            const messageParts: MessagePart[] = []

            // Handle text content
            if (results) {
                if (Array.isArray(results)) {
                    // Handle array results (MCP format)
                    if (
                        results.some(
                            r => r.content && r.outputType === 'mcp' && r.metadata?.includes('text')
                        )
                    ) {
                        const textResult = results.find(r => r.metadata?.includes('text'))
                        messageParts.push({
                            type: 'text',
                            text: textResult?.content || '',
                        })
                    }

                    if (
                        results.some(
                            r => r.content && r.outputType === 'mcp' && r.metadata?.includes('image')
                        )
                    ) {
                        const imageResult = results.find(r => r.metadata?.includes('image'))
                        const imageUrls = imageResult?.content?.split('\n') || []
                        for (const url of imageUrls) {
                            const base64Data = url.replace(/^data:image\/\w+;base64,/, '')
                            messageParts.push({
                                type: 'image_url',
                                image_url: { url: base64Data },
                            })
                        }
                    }
                } else {
                    // Handle non-array results (diagnostic, terminal output etc.)
                    if (results.content) {
                        messageParts.push({
                            type: 'text',
                            text: results.content,
                        })
                    }
                }
            } else {
                messageParts.push({
                    type: 'text',
                    text: `Tool ${toolCall.tool_call.name} failed`,
                })
            }

            // Update tool result content with all parts
            tool_result.tool_result.content = JSON.stringify(messageParts)

            return {
                tool_result,
                output: {
                    ...(Array.isArray(results) && results.length > 0 ? results[0] : results), // Use first result for base properties if available
                    ...tool_item,
                    status: UIToolStatus.Done,
                },
            }
        } catch (error) {
            tool_result.tool_result.content = String(error)
            return {
                tool_result,
                output: {
                    uri: URI.parse(''),
                    type: 'tool-state',
                    content: String(error),
                    ...tool_item,
                    status: UIToolStatus.Error,
                    outputType: 'status',
                },
            }
        }
    }
    /**
     * Handle errors with consistent logging and reporting
     */
    private handleError(
        sessionID: string,
        error: unknown,
        delegate: AgentHandlerDelegate,
        signal: AbortSignal
    ): void {
        logDebug('AgenticHandler', `Error in agent session ${sessionID}`, {
            verbose:
                error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        })

        // Only post error if not aborted
        if (!signal.aborted) {
            delegate.postError(error instanceof Error ? error : new Error(String(error)), 'transcript')
        }
    }
}

// TEMPORARY CONTEXT WINDOW
const contextWindow = { input: 180000, output: 8000 }

// A prompter that creates a prompt for an agentic chat model
class AgenticChatPrompter {
    private readonly preamble: ChatMessage
    constructor(preamble: PromptString) {
        this.preamble = { speaker: 'system', text: preamble }
    }

    public async makePrompt(chat: ChatBuilder, context: ContextItem[] = []): Promise<Message[]> {
        const builder = await PromptBuilder.create(contextWindow)

        // Add preamble messages
        if (!builder.tryAddToPrefix([this.preamble])) {
            throw new Error(`Preamble length exceeded context window ${contextWindow.input}`)
        }

        // Add existing chat transcript messages
        const transcript = chat.getDehydratedMessages()
        const reversedTranscript = [...transcript].reverse()

        builder.tryAddMessages(reversedTranscript)

        if (context.length) {
            const { added } = await builder.tryAddContext('user', transformItems(context))
            chat.setLastMessageContext(added)
        }

        const historyItems = reversedTranscript
            .flatMap(m => (m.contextFiles ? [...m.contextFiles].reverse() : []))
            .filter(isDefined)

        if (historyItems.length) {
            await builder.tryAddContext('history', transformItems(historyItems))
        }

        // Get the raw messages without sanitization
        const prefixMessages = builder.prefixMessages
        const reverseMessages = builder.reverseMessages
        if (builder.contextItems.length > 0) {
            const contextMessages = builder.buildContextMessages()
            reverseMessages.push(...contextMessages)
        }
        const chatMessages = [...reverseMessages].reverse()
        return prefixMessages.concat(chatMessages)
    }
}
function transformItems(items: ContextItem[]): ContextItem[] {
    return items
        .filter(item => item.type !== 'tool-state')
        ?.map(i => {
            if (i.type === 'file' && !i.range) {
                i.content = i.content?.concat('\n<<EOF>>')
            }
            return i
        })
}

/**
 * Converts a list of Anthropic Tool objects (from the Model Context Protocol schema)
 * into the structure expected by the Gemini API for the 'tools' parameter.
 * This uses a recursive cleaning function to ensure only supported schema fields are included.
 *
 * @param mcpTools - An object containing a list of AgentTool objects (which wrap Anthropic Tool specs).
 * @returns An array containing a single object with the 'functionDeclarations' property,
 *          formatted for the Gemini API's 'tools' parameter.
 */
function convertAnthropicToolsToGeminiTools(mcpTools: { tools: AgentTool[] }): GeminiToolsParam {
    const functionDeclarations: GeminiFunctionDeclaration[] = []

    for (const tool of mcpTools.tools) {
        // Ensure tool.spec and tool.spec.input_schema exist and are structured as expected
        // A tool input schema should generally be an object with properties.
        if (
            !tool.spec ||
            !tool.spec.input_schema ||
            tool.spec.input_schema.type !== 'object' ||
            !tool.spec.input_schema.properties ||
            typeof tool.spec.input_schema.properties !== 'object'
        ) {
            // Log a warning for invalid schema structure before skipping
            logDebug(
                `Skipping tool "${tool.spec?.name}" due to invalid or non-object input_schema structure. Schema:`,
                JSON.stringify(tool.spec?.input_schema)
            )
            continue
        }

        const originalInputSchema = tool.spec.input_schema as Record<string, any> // Cast for easier property access

        // Clean each top-level parameter schema using the recursive helper
        const cleanedParametersProperties: Record<string, GeminiParameterSchema> = {}
        const originalProperties = originalInputSchema.properties as Record<string, any>

        for (const key in originalProperties) {
            if (Object.hasOwnProperty.call(originalProperties, key)) {
                const originalParamSchema = originalProperties[key]
                const cleanedParamSchema = cleanSchemaForGemini(originalParamSchema)

                // Only add the parameter to the function definition if the cleaned schema is not empty
                if (Object.keys(cleanedParamSchema).length > 0) {
                    cleanedParametersProperties[key] = cleanedParamSchema
                }
            }
        }

        // Create the Gemini function declaration object
        const functionDeclaration: GeminiFunctionDeclaration = {
            name: tool.spec.name,
            description: tool.spec.description, // Use the tool's description
            parameters: {
                // This structure is required by Gemini for function call parameters
                type: 'object', // The parameters wrapper itself is always an object
                properties: cleanedParametersProperties, // Use the *cleaned* parameter properties we just built
                // Include 'required' from the original input_schema (top level required for the object's properties)
                // Ensure it's an array if present, otherwise default to empty array
                required:
                    originalInputSchema.required !== undefined &&
                    Array.isArray(originalInputSchema.required)
                        ? originalInputSchema.required
                        : [],
            },
        }

        // Add the constructed Gemini function declaration object to the list
        functionDeclarations.push(functionDeclaration)
    }

    // Wrap the list of function declarations in the required GeminiToolWrapper object
    const geminiToolWrapper: GeminiToolWrapper = {
        functionDeclarations: functionDeclarations,
    }

    // Return the wrapper object within an array, as required by the Gemini API 'tools' parameter
    // Return an empty array if no valid function declarations were created
    return functionDeclarations.length > 0 ? [geminiToolWrapper] : []
}

/**
 * Recursively cleans a JSON Schema object to only include fields supported by the Gemini API's Schema definition.
 *
 * @param schema - The schema object (or a part of one) to clean.
 * @returns A new object containing only the Gemini-supported schema fields.
 */
function cleanSchemaForGemini(schema: any): GeminiParameterSchema {
    if (!schema || typeof schema !== 'object') {
        return {} // Return empty object for invalid input
    }

    const cleaned: GeminiParameterSchema = {}

    // Explicitly copy allowed fields from the original schema
    if (schema.type !== undefined) cleaned.type = schema.type // Keep original type string (e.g., 'string', 'integer', 'object', 'array')
    if (schema.format !== undefined) cleaned.format = schema.format
    if (schema.title !== undefined) cleaned.title = schema.title
    if (schema.description !== undefined) cleaned.description = schema.description
    if (schema.nullable !== undefined) cleaned.nullable = schema.nullable

    // Ensure enum is an array if present
    if (schema.enum !== undefined && Array.isArray(schema.enum)) {
        // Perform a basic validation/cleaning of enum values if necessary,
        // but for now assume the array elements are acceptable primitive types.
        cleaned.enum = schema.enum
    }

    // Handle array properties, casting to string as per Gemini spec if needed
    if (schema.maxItems !== undefined) cleaned.maxItems = String(schema.maxItems)
    if (schema.minItems !== undefined) cleaned.minItems = String(schema.minItems)

    // Handle number/integer properties
    if (schema.minimum !== undefined) cleaned.minimum = schema.minimum
    if (schema.maximum !== undefined) cleaned.maximum = schema.maximum

    // Handle recursive structures: properties for objects
    if (cleaned.type === 'object' && schema.properties && typeof schema.properties === 'object') {
        cleaned.properties = {}
        for (const propKey in schema.properties) {
            if (Object.hasOwnProperty.call(schema.properties, propKey)) {
                // Recursively clean nested property schemas
                const cleanedPropertySchema = cleanSchemaForGemini(schema.properties[propKey])
                // Only include the property if the cleaned nested schema is not empty
                if (Object.keys(cleanedPropertySchema).length > 0) {
                    cleaned.properties[propKey] = cleanedPropertySchema
                }
            }
        }
        // If no properties remain after cleaning, remove the properties object
        if (Object.keys(cleaned.properties).length === 0) {
            cleaned.properties = undefined
        }

        // Copy 'required' array for object types' *properties* if it exists and is an array
        if (schema.required !== undefined && Array.isArray(schema.required)) {
            // Optional: You might want to filter this 'required' array to only include
            // property keys that actually exist in the `cleaned.properties` object.
            cleaned.required = schema.required
        }
    }

    // Handle recursive structures: items for arrays
    if (cleaned.type === 'array' && schema.items && typeof schema.items === 'object') {
        // Recursively clean the items schema
        const cleanedItemsSchema = cleanSchemaForGemini(schema.items)
        // Only include items if the cleaned nested schema is not empty
        if (Object.keys(cleanedItemsSchema).length > 0) {
            cleaned.items = cleanedItemsSchema
        }
    }

    // Handle recursive structures: anyOf
    if (schema.anyOf !== undefined && Array.isArray(schema.anyOf)) {
        const cleanedAnyOf = schema.anyOf
            .map((item: any) => cleanSchemaForGemini(item))
            .filter((item: any) => Object.keys(item).length > 0) // Filter out empty results from sub-schemas

        if (cleanedAnyOf.length > 0) {
            cleaned.anyOf = cleanedAnyOf
        }
    }

    // After processing, if the cleaned object only contains a 'type' and nothing else
    // (and it's not a basic primitive type), or if it's completely empty,
    // we might consider if it represents a valid schema definition for Gemini.
    // For simplicity, we'll return the object as is; the caller (convertAnthropicToolsToGeminiTools)
    // will check if the top-level parameter schema is empty.

    return cleaned
}
