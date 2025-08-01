import capitalize from 'lodash/capitalize'
import { LRUCache } from 'lru-cache'
import * as uuid from 'uuid'
import type * as vscode from 'vscode'

import { type CodeToReplaceData, type DocumentContext, isDotComAuthed } from '@sourcegraph/cody-shared'
import { convertAutocompleteContextSnippetForTelemetry } from '../../../src/completions/analytics-logger'
import { getOtherCompletionProvider } from '../../completions/analytics-logger'
import { lines } from '../../completions/text-processing'
import { charactersLogger } from '../../services/CharactersLogger'
//import { upstreamHealthProvider } from '../../services/UpstreamHealthProvider'
import { captureException, shouldErrorBeReported } from '../../services/sentry/sentry'
import type { AutoeditsPrompt, PartialModelResponse, SuccessModelResponse } from '../adapters/base'
import { autoeditsOutputChannelLogger } from '../output-channel-logger'
import type { DecorationInfo } from '../renderer/decorators/base'
import { getDecorationStats } from '../renderer/diff-utils'

import type { AutocompleteContextSnippet } from '../../../../lib/shared/src/completions/types'
import { autoeditDebugStore } from '../debug-panel/debug-store'
import type { AutoEditRenderOutput } from '../renderer/render-output'
import { autoeditIdRegistry } from './suggestion-id-registry'
import {
    type AcceptedState,
    type AutoeditAcceptReasonMetadata,
    type AutoeditCacheID,
    type AutoeditDiscardReasonMetadata,
    type AutoeditHotStreakID,
    type AutoeditRejectReasonMetadata,
    type AutoeditRequestID,
    type ContextLoadedState,
    type DiscardedState,
    type LoadedState,
    type Phase,
    type PhaseStates,
    type RejectedState,
    type StartedState,
    type SuggestedState,
    validRequestTransitions,
} from './types'
import type { AutoeditFeedbackData, HotStreakChunk, PostProcessedState } from './types'

/**
 * Using the validTransitions definition, we can derive which "from phases" lead to a given next phase,
 * and map that to the correct PhaseStates[fromPhase].
 */
type PreviousPossiblePhaseFrom<T extends Phase> = {
    [F in Phase]: T extends (typeof validRequestTransitions)[F][number] ? PhaseStates[F] : never
}[Phase]

type AutoeditRequestState = PhaseStates[Phase]

type AutoeditEventAction =
    | 'suggested'
    | 'accepted'
    | 'discarded'
    | 'error'
    | 'feedback-submitted'
    | `invalidTransitionTo${Capitalize<Phase>}`

/**
 * Specialized string type for referencing error messages in our rate-limiting map.
 */
type AutoeditErrorMessage = string & { readonly _brand: 'AutoeditErrorMessage' }

export class AutoeditAnalyticsLogger {
    /**
     * Stores ephemeral AutoeditRequestState for each request ID.
     */
    private activeRequests = new LRUCache<AutoeditRequestID, AutoeditRequestState>({ max: 20 })

    /**
     * Tracks repeated errors via their message key to avoid spamming logs.
     */
    private errorCounts = new Map<AutoeditErrorMessage, number>()
    private autoeditsStartedSinceLastSuggestion = 0
    private ERROR_THROTTLE_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

    /**
     * Creates a new ephemeral request with initial metadata. At this stage, we do not have the prediction yet.
     */
    public createRequest({
        startedAt,
        filePath,
        payload,
        codeToReplaceData,
        document,
        position,
        requestDocContext,
    }: {
        startedAt: number
        filePath: string
        codeToReplaceData: CodeToReplaceData
        document: vscode.TextDocument
        position: vscode.Position
        requestDocContext: DocumentContext
        payload: Required<
            Pick<StartedState['payload'], 'languageId' | 'model' | 'triggerKind' | 'codeToRewrite'>
        >
    }): AutoeditRequestID {
        const { codeToRewrite, ...restPayload } = payload
        const requestId = uuid.v4() as AutoeditRequestID
        const otherCompletionProviders = getOtherCompletionProvider()

        const request: StartedState = {
            requestId,
            phase: 'started',
            startedAt,
            filePath,
            requestCodeToReplaceData: codeToReplaceData,
            codeToReplaceData,
            document,
            position,
            requestDocContext,
            payload: {
                otherCompletionProviderEnabled: otherCompletionProviders.length > 0,
                otherCompletionProviders,
                // 🚨 SECURITY: included only for DotCom users.
                codeToRewrite: isDotComAuthed() ? codeToRewrite : undefined,
                ...restPayload,
            },
        }

        this.activeRequests.set(requestId, request)
        this.autoeditsStartedSinceLastSuggestion++

        return requestId
    }

    public markAsContextLoaded({
        requestId,
        context,
        payload,
    }: {
        requestId: AutoeditRequestID
        context: AutocompleteContextSnippet[]
        payload: Pick<ContextLoadedState['payload'], 'contextSummary'>
    }): void {
        this.tryTransitionTo(requestId, 'contextLoaded', request => ({
            ...request,
            contextLoadedAt: getTimeNowInMillis(),
            context: convertAutocompleteContextSnippetForTelemetry(context),
            payload: {
                ...request.payload,
                contextSummary: payload.contextSummary,
            },
        }))
    }

    /**
     * Mark when the suggestion finished generating/loading. This is also where
     * we finally receive the prediction text, create a stable suggestion ID,
     * and store the full suggestion metadata in ephemeral state.
     */
    public markAsLoaded({
        requestId,
        prompt,
        payload,
        modelResponse,
    }: {
        modelResponse: SuccessModelResponse | PartialModelResponse
        requestId: AutoeditRequestID
        prompt: AutoeditsPrompt
        payload: Required<Pick<LoadedState['payload'], 'source' | 'isFuzzyMatch' | 'prediction'>>
    }): void {
        const { prediction, source, isFuzzyMatch } = payload
        const stableId = autoeditIdRegistry.getOrCreate(prompt, prediction)
        const loadedAt = getTimeNowInMillis()

        this.tryTransitionTo(requestId, 'loaded', request => {
            return {
                ...request,
                loadedAt,
                modelResponse,
                payload: {
                    ...request.payload,
                    id: stableId,
                    // 🚨 SECURITY: included only for DotCom users.
                    prediction: isDotComAuthed() && prediction.length < 300 ? prediction : undefined,
                    source,
                    isFuzzyMatch,
                    responseHeaders:
                        'responseHeaders' in modelResponse ? modelResponse.responseHeaders : {},
                    latency: Math.floor(loadedAt - request.startedAt),
                },
            }
        })
    }

    public recordHotStreakLoaded({
        requestId,
        hotStreakId,
        chunk,
    }: {
        requestId: AutoeditRequestID
        hotStreakId: AutoeditHotStreakID
        chunk: Omit<HotStreakChunk, 'loadedAt' | 'hotStreakId'>
    }) {
        const request = this.activeRequests.get(requestId) as PostProcessedState
        const hotStreakChunks = request.hotStreakChunks ?? []
        hotStreakChunks.push({
            hotStreakId,
            loadedAt: getTimeNowInMillis(),
            prediction: chunk.prediction,
            modelResponse: chunk.modelResponse,
            fullPrediction: chunk.fullPrediction,
        })
        this.activeRequests.set(requestId, { ...request, hotStreakChunks })
    }

    public markAsPostProcessed({
        requestId,
        cacheId,
        hotStreakId,
        codeToReplaceData,
        predictionDocContext,
        editPosition,
    }: {
        requestId: AutoeditRequestID
        cacheId: AutoeditCacheID
        hotStreakId?: AutoeditHotStreakID
        codeToReplaceData: CodeToReplaceData
        predictionDocContext: DocumentContext
        editPosition: vscode.Position
    }): void {
        this.tryTransitionTo(requestId, 'postProcessed', request => {
            return {
                ...request,
                codeToReplaceData,
                predictionDocContext,
                cacheId,
                hotStreakId,
                editPosition,
            }
        })
    }

    public markAsReadyToBeRendered({
        requestId,
        decorationInfo,
        prediction,
        renderOutput,
    }: {
        requestId: AutoeditRequestID
        prediction: string
        decorationInfo: DecorationInfo | null
        renderOutput: AutoEditRenderOutput
    }) {
        this.tryTransitionTo(requestId, 'readyToBeRendered', request => {
            const completion =
                'inlineCompletionItems' in renderOutput
                    ? renderOutput.inlineCompletionItems[0]
                    : undefined

            const insertText = completion?.withoutCurrentLinePrefix.insertText

            return {
                ...request,
                postProcessedAt: getTimeNowInMillis(),
                prediction,
                renderOutput,
                payload: {
                    ...request.payload,
                    decorationStats: decorationInfo ? getDecorationStats(decorationInfo) : undefined,
                    inlineCompletionStats: insertText
                        ? {
                              lineCount: lines(insertText).length,
                              charCount: insertText.length,
                          }
                        : undefined,
                },
            }
        })
    }

    public markAsSuggested(requestId: AutoeditRequestID): SuggestedState | null {
        const result = this.tryTransitionTo(requestId, 'suggested', currentRequest => ({
            ...currentRequest,
            suggestedAt: getTimeNowInMillis(),
        }))

        if (!result) {
            return null
        }

        return result.updatedRequest
    }

    public markAsRead(requestId: AutoeditRequestID): void {
        this.tryTransitionTo(requestId, 'read', currentRequest => ({
            ...currentRequest,
            readAt: getTimeNowInMillis(),
        }))
    }

    public markAsAccepted({
        requestId,
        acceptReason,
    }: {
        requestId: AutoeditRequestID
        acceptReason: AutoeditAcceptReasonMetadata
    }): void {
        const acceptedAt = getTimeNowInMillis()

        const result = this.tryTransitionTo(requestId, 'accepted', request => {
            const { codeToReplaceData, document, prediction, payload } = request

            // Ensure the AutoeditSuggestionID is never reused by removing it from the suggestion id registry
            autoeditIdRegistry.deleteEntryIfValueExists(payload.id)

            // Calculate metadata required for PCW.
            const rangeForCharacterMetadata = codeToReplaceData.range
            const { charsDeleted, charsInserted, ...charactersLoggerMetadata } =
                charactersLogger.getChangeEventMetadataForCodyCodeGenEvents({
                    document,
                    contentChanges: [
                        {
                            range: rangeForCharacterMetadata,
                            rangeOffset: document.offsetAt(rangeForCharacterMetadata.start),
                            rangeLength: 0,
                            text: prediction,
                        },
                    ],
                    reason: undefined,
                })

            return {
                ...request,
                acceptedAt,
                payload: {
                    ...request.payload,
                    ...charactersLoggerMetadata,
                    isAccepted: true,
                    isRead: true,
                    timeFromSuggestedAt: acceptedAt - request.suggestedAt,
                    suggestionsStartedSinceLastSuggestion: this.autoeditsStartedSinceLastSuggestion,
                    acceptReason,
                },
            }
        })

        if (result?.updatedRequest) {
            this.writeAutoeditRequestEvent('suggested', result.updatedRequest)
            this.writeAutoeditRequestEvent('accepted', result.updatedRequest)
        }
    }

    public markAsRejected({
        requestId,
        rejectReason,
    }: {
        requestId: AutoeditRequestID
        rejectReason: AutoeditRejectReasonMetadata
    }): void {
        const rejectedAt = getTimeNowInMillis()

        const result = this.tryTransitionTo(requestId, 'rejected', request => ({
            ...request,
            rejectedAt,
            payload: {
                ...request.payload,
                isAccepted: false,
                isRead: 'readAt' in request,
                timeFromSuggestedAt: rejectedAt - request.suggestedAt,
                suggestionsStartedSinceLastSuggestion: this.autoeditsStartedSinceLastSuggestion,
                rejectReason,
            },
        }))

        if (result?.updatedRequest) {
            this.writeAutoeditRequestEvent('suggested', result.updatedRequest)

            // Suggestions are kept in the LRU cache for longer. This is because they
            // can still become visible if e.g. they are served from the cache and we
            // need to retain the ability to mark them as seen.
        }
    }

    public markAsDiscarded({
        requestId,
        discardReason,
        prediction,
    }: {
        requestId: AutoeditRequestID
        discardReason: AutoeditDiscardReasonMetadata
        prediction?: string
    }): void {
        const result = this.tryTransitionTo(requestId, 'discarded', request => {
            return {
                ...request,
                discardedAt: getTimeNowInMillis(),
                prediction,
                payload: {
                    ...request.payload,
                    discardReason,
                },
            }
        })

        if (result?.updatedRequest) {
            this.writeAutoeditRequestEvent('discarded', result.updatedRequest)
        }
    }

    public getRequest(requestId: AutoeditRequestID): AutoeditRequestState | undefined {
        return this.activeRequests.get(requestId)
    }

    private tryTransitionTo<P extends Phase>(
        requestId: AutoeditRequestID,
        nextPhase: P,
        patch: (currentRequest: PreviousPossiblePhaseFrom<P>) => Omit<PhaseStates[P], 'phase'>
    ): { currentRequest: PreviousPossiblePhaseFrom<P>; updatedRequest: PhaseStates[P] } | null {
        const currentRequest = this.getRequestIfReadyForNextPhase(requestId, nextPhase)

        if (!currentRequest) {
            return null
        }

        const updatedRequest = {
            ...currentRequest,
            ...patch(currentRequest),
            phase: nextPhase,
        } as PhaseStates[P]

        // Integrate auto-edit analytics logger with the auto-edit debug panel.
        autoeditDebugStore.addAutoeditRequestDebugState(updatedRequest)

        this.activeRequests.set(requestId, updatedRequest)

        return { updatedRequest, currentRequest }
    }

    /**
     * Retrieves the request if it is in a phase that can transition to nextPhase,
     * returning null if not found or if the transition is invalid. Uses the derived
     * PreviousPossiblePhaseFrom type so that the returned State has the correct fields.
     */
    private getRequestIfReadyForNextPhase<T extends Phase>(
        requestId: AutoeditRequestID,
        nextPhase: T
    ): PreviousPossiblePhaseFrom<T> | null {
        const request = this.activeRequests.get(requestId)

        if (
            !request ||
            !(validRequestTransitions[request.phase] as readonly Phase[]).includes(nextPhase)
        ) {
            this.writeAutoeditEvent({
                action: `invalidTransitionTo${capitalize(nextPhase) as Capitalize<Phase>}`,
                logDebugArgs: [request ? `from: "${request.phase}"` : 'missing request'],
            })

            return null
        }

        return request as PreviousPossiblePhaseFrom<T>
    }

    private writeAutoeditRequestEvent(
        action: AutoeditEventAction,
        state: AcceptedState | RejectedState | DiscardedState
    ): void {
        const { suggestionLoggedAt } = state

        if (action === 'suggested' && suggestionLoggedAt) {
            return
        }

        // Update the request state to mark the suggestion as logged.
        state.suggestionLoggedAt = getTimeNowInMillis()

        this.writeAutoeditEvent({
            action,
            logDebugArgs: terminalStateToLogDebugArgs(action, state),
        })
    }

    private writeAutoeditEvent({
        action,
        logDebugArgs,
    }: {
        action: AutoeditEventAction
        logDebugArgs: readonly [string, ...unknown[]]
    }): void {
        autoeditsOutputChannelLogger.logDebug('writeAutoeditEvent', action, ...logDebugArgs)
    }
    /**
     * Rate-limited error logging, capturing exceptions with Sentry and grouping repeated logs.
     */
    public logError(error: Error): void {
        if (!shouldErrorBeReported(error, false)) {
            return
        }
        captureException(error)

        const messageKey = error.message as AutoeditErrorMessage

        const currentCount = this.errorCounts.get(messageKey) ?? 0
        const logDebugArgs = [error.name, { verbose: { message: error.message } }] as const
        if (currentCount === 0) {
            this.writeAutoeditEvent({
                action: 'error',
                logDebugArgs,
            })

            // After the interval, flush repeated errors
            setTimeout(() => {
                const finalCount = this.errorCounts.get(messageKey) ?? 0
                if (finalCount > 0) {
                    this.writeAutoeditEvent({
                        action: 'error',
                        logDebugArgs,
                    })
                }
                this.errorCounts.set(messageKey, 0)
            }, this.ERROR_THROTTLE_INTERVAL_MS)
        }
        this.errorCounts.set(messageKey, currentCount + 1)
    }

    public logFeedback(feedbackData: AutoeditFeedbackData): void {
        this.writeAutoeditEvent({
            action: 'feedback-submitted',
            logDebugArgs: [`Feedback submitted for file: ${feedbackData.file_path}`],
        })
    }
}

export const autoeditAnalyticsLogger = new AutoeditAnalyticsLogger()

export function getTimeNowInMillis(): number {
    return Math.floor(performance.now())
}

function terminalStateToLogDebugArgs(
    action: AutoeditEventAction,
    { requestId, phase, payload }: AcceptedState | RejectedState | DiscardedState
): readonly [string, ...unknown[]] {
    if (action === 'suggested' && (phase === 'rejected' || phase === 'accepted')) {
        return [`"${requestId}" latency:"${payload.latency}ms" isRead:"${payload.isRead}"`]
    }

    return [`"${requestId}"`]
}
