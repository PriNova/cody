import type { Span } from '@opentelemetry/api'

import { type FireworksCodeCompletionParams, addClientInfoParams, getSerializedParams } from '../..'
import { currentResolvedConfig } from '../../configuration/resolver'
import { useCustomChatClient } from '../../llm-providers'
import { recordErrorToSpan } from '../../tracing'

import type {
    CompletionCallbacks,
    CompletionGeneratorValue,
    CompletionParameters,
    CompletionResponse,
    Event,
    SerializedCompletionParameters,
} from './types'

export interface CompletionLogger {
    startCompletion(
        params: CompletionParameters | unknown,
        endpoint: string
    ):
        | undefined
        | {
              onError: (error: string, rawError?: unknown) => void
              onComplete: (response: CompletionResponse) => void
              onEvents: (events: Event[]) => void
              onFetch: (
                  httpClientLabel: string,
                  body: SerializedCompletionParameters | FireworksCodeCompletionParams
              ) => void
          }
}

export interface CompletionRequestParameters {
    apiVersion: number
    interactionId?: string
    customHeaders?: Record<string, string>
}

/**
 * Access the chat based LLM APIs via a Sourcegraph server instance.
 *
 * 🚨 SECURITY: It is the caller's responsibility to ensure context from
 * all cody ignored files are removed before sending requests to the server.
 */
export abstract class SourcegraphCompletionsClient {
    private errorEncountered = false

    constructor(protected logger?: CompletionLogger) {}

    protected async completionsEndpoint(): Promise<string> {
        return new URL('/.api/completions/stream', (await currentResolvedConfig()).auth.serverEndpoint)
            .href
    }

    protected sendEvents(events: Event[], cb: CompletionCallbacks, span?: Span): void {
        // If no events are provided, log a warning but don't throw an error
        if (!events || events.length === 0) {
            const warning = 'No usage data detected for completion request'
            console.warn(warning)
            return
        }

        for (const event of events) {
            switch (event.type) {
                case 'completion': {
                    span?.addEvent('yield', { stopReason: event.stopReason })
                    cb.onChange(event.completion, event.content)
                    break
                }
                case 'error': {
                    const error = new Error(event.error)
                    if (span) {
                        recordErrorToSpan(span, error)
                    }
                    this.errorEncountered = true
                    cb.onError(error)
                    break
                }
                case 'done': {
                    if (!this.errorEncountered) {
                        cb.onComplete()
                    }
                    // reset errorEncountered for next request
                    this.errorEncountered = false
                    span?.end()
                    break
                }
            }
        }
    }

    protected async prepareRequest(
        params: CompletionParameters,
        requestParams: CompletionRequestParameters
    ): Promise<{
        url: URL
        serializedParams: SerializedCompletionParameters
        headerParams: Record<string, string>
    }> {
        const { apiVersion, interactionId } = requestParams
        const serializedParams = await getSerializedParams(params)
        const headerParams: Record<string, string> = {}
        if (interactionId) {
            headerParams['X-Sourcegraph-Interaction-ID'] = interactionId
        }
        const url = new URL(await this.completionsEndpoint())
        if (apiVersion >= 1) {
            url.searchParams.append('api-version', '' + apiVersion)
        }
        addClientInfoParams(url.searchParams)
        return { url, serializedParams, headerParams }
    }

    protected abstract _fetchWithCallbacks(
        params: CompletionParameters,
        requestParams: CompletionRequestParameters,
        cb: CompletionCallbacks,
        signal?: AbortSignal
    ): Promise<void>

    protected abstract _streamWithCallbacks(
        params: CompletionParameters,
        requestParams: CompletionRequestParameters,
        cb: CompletionCallbacks,
        signal?: AbortSignal
    ): Promise<void>

    public async *stream(
        params: CompletionParameters,
        requestParams: CompletionRequestParameters,
        signal?: AbortSignal
    ): AsyncGenerator<CompletionGeneratorValue> {
        // Provide default stop sequence for starchat models.
        if (!params.stopSequences && params?.model?.startsWith('openaicompatible/starchat')) {
            params.stopSequences = ['<|end|>']
        }

        // This is a technique to convert a function that takes callbacks to an async generator.
        const values: Promise<CompletionGeneratorValue>[] = []
        let resolve: ((value: CompletionGeneratorValue) => void) | undefined
        values.push(
            new Promise(r => {
                resolve = r
            })
        )

        const send = (value: CompletionGeneratorValue): void => {
            resolve!(value)
            values.push(
                new Promise(r => {
                    resolve = r
                })
            )
        }
        const callbacks: CompletionCallbacks = {
            onChange(text, content) {
                const value: CompletionGeneratorValue = { type: 'change', text }
                // Include the content field if it exists (contains delta_tool_calls)
                if (content) {
                    value.content = content
                }
                send(value)
            },
            onComplete() {
                send({ type: 'complete' })
            },
            onError(error, statusCode) {
                send({ type: 'error', error, statusCode })
            },
        }

        // Custom chat clients for Non-Sourcegraph-supported providers.
        await useCustomChatClient({
            completionsEndpoint: await this.completionsEndpoint(),
            params,
            cb: callbacks,
            logger: this.logger,
            signal,
        })

        for (let i = 0; ; i++) {
            const val = await values[i]
            delete values[i]
            yield val
            if (val.type === 'complete' || val.type === 'error') {
                break
            }
        }
    }
}
