import type { Span } from '@opentelemetry/api'
import {
    type ChatMessage,
    type ContextItem,
    type Message,
    type MessagePart,
    PromptString,
    type ToolCallContentPart,
    type ToolResultContentPart,
    UIToolStatus,
    isDefined,
    logDebug,
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

enum AGENT_MODELS {
    ExtendedThinking = 'anthropic::2024-10-22::claude-3-7-sonnet-extended-thinking',
    Base = 'anthropic::2024-10-22::claude-3-7-sonnet-latest',
}

interface ToolResult {
    output: ContextItemToolState
    tool_result: ToolResultContentPart
}

/**
 * Base AgenticHandler class that manages tool execution state
 * and implements the core agentic conversation loop when Agent Mode is enabled.
 */
export class AgenticHandler extends ChatHandler implements AgentHandler {
    public static readonly id = 'agentic-chat'
    protected readonly SYSTEM_PROMPT: PromptString
    protected readonly MAX_TURN = 50

    protected tools: AgentTool[] = []

    constructor(
        contextRetriever: Pick<ContextRetriever, 'retrieveContext' | 'computeDidYouMean'>,
        editor: ChatControllerOptions['editor'],
        protected readonly chatClient: ChatControllerOptions['chatClient']
    ) {
        super(contextRetriever, editor, chatClient)
        this.SYSTEM_PROMPT = PromptString.unsafe_fromUserQuery(buildAgentPrompt())
    }

    public async handle(req: AgentRequest, delegate: AgentHandlerDelegate): Promise<void> {
        const { requestID, chatBuilder, inputText, editorState, span, signal, mentions } = req
        const sessionID = chatBuilder.sessionID

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

        try {
            // Run the main conversation loop
            await this.runConversationLoop(chatBuilder, delegate, span, signal, contextItems)
        } catch (error) {
            this.handleError(sessionID, error, delegate, signal)
        } finally {
            delegate.postDone()
            logDebug('AgenticHandler', `Ending agent session ${sessionID}`)
            logDebug('AgenticHandler', `Session ${sessionID} duration: ${Date.now() - startTime}ms`)
        }
    }

    /**
     * Run the main conversation loop, processing LLM responses and executing tools
     */
    protected async runConversationLoop(
        chatBuilder: ChatBuilder,
        delegate: AgentHandlerDelegate,

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
            const model = turnCount === 0 ? AGENT_MODELS.ExtendedThinking : AGENT_MODELS.Base

            try {
                // Get LLM response
                const { botResponse, toolCalls } = await this.requestLLM(
                    chatBuilder,
                    delegate,

                    span,
                    signal,
                    model,
                    contextItems
                )

                // No tool calls means we're done
                if (!toolCalls?.size) {
                    chatBuilder.addBotMessage(botResponse, model)
                    logDebug('AgenticHandler', 'No tool calls, ending conversation')
                    break
                }

                // Execute tools and update results
                const content = Array.from(toolCalls.values())
                delegate.postMessageInProgress(botResponse)

                const results = await this.executeTools(content, model).catch(() => {
                    logDebug('AgenticHandler', 'Error executing tools')
                    return []
                })

                const toolResults = results?.map(result => result.tool_result).filter(isDefined)
                const toolOutputs = results?.map(result => result.output).filter(isDefined)
                const outputParts = toolOutputs
                    ?.map(o => o.parts)
                    .filter(isDefined)
                    .flat()

                botResponse.contextFiles = toolOutputs

                delegate.postMessageInProgress(botResponse)

                chatBuilder.addBotMessage(botResponse, model)

                // Add a human message to hold tool results
                chatBuilder.addHumanMessage({
                    content: [...toolResults, ...outputParts],
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

        span: Span,
        signal: AbortSignal,
        model: string,
        contextItems: ContextItem[]
    ): Promise<{ botResponse: ChatMessage; toolCalls: Map<string, ToolCallContentPart> }> {
        // Create prompt
        const prompter = new AgenticChatPrompter(this.SYSTEM_PROMPT)
        const prompt = await prompter.makePrompt(chatBuilder, contextItems)

        // WORKAROUND: Fix empty string arguments in the final prompt before sending to API
        const fixedPrompt = fixEmptyToolArgumentsInPrompt(prompt)

        // No longer recording chat question executed telemetry in agentic handlers
        // This is now only done when user submits a query
        logDebug('AgenticHandler', 'Prompt created', { verbose: fixedPrompt })
        // Prepare API call parameters
        const params = {
            maxTokensToSample: 8000,
            messages: JSON.stringify(fixedPrompt),
            // Ensure unique tool names by using a Map keyed by tool name
            tools: Array.from(
                new Map(
                    this.tools.map(tool => [
                        tool.spec.name,
                        {
                            type: 'function',
                            function: {
                                name: tool.spec.name,
                                description: tool.spec.description,
                                parameters: tool.spec.input_schema,
                            },
                        },
                    ])
                ).values()
            ),
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
                    const deltaText = message.text.slice(streamed.text?.length)
                    streamed.text = message.text
                    // Only process if there's actual new content
                    if (deltaText) {
                        delegate.postMessageInProgress({
                            speaker: 'assistant',
                            content: [streamed],
                            text: PromptString.unsafe_fromLLMResponse(message.text),
                            model,
                        })
                    }

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
            logDebug('AgenticHandler', `Calling ${toolCall?.tool_call?.name}`, { verbose: toolCall })
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
                        logDebug('AgenticHandler', `Error executing tool ${toolCall.tool_call?.name}`, {
                            verbose: error,
                        })
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

        // Update status to pending *before* execution
        try {
            const args = parseToolCallArgs(toolCall.tool_call.arguments)
            const result = await tool.invoke(args).catch(error => {
                logDebug('AgenticHandler', `Error executing tool ${toolCall.tool_call.name}`, {
                    verbose: error,
                })
                return null
            })

            if (result === null) {
                throw new Error(`Tool ${toolCall.tool_call.name} failed`)
            }

            tool_result.tool_result.content = result.content || 'Empty result'

            logDebug('AgenticHandler', `Executed ${toolCall.tool_call.name}`, { verbose: result })

            return {
                tool_result,
                output: {
                    ...result,
                    ...tool_item,
                    status: UIToolStatus.Done,
                },
            }
        } catch (error) {
            tool_result.tool_result.content = String(error)

            logDebug('AgenticHandler', `${toolCall.tool_call.name} failed`, { verbose: error })
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
        return builder.build()
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
