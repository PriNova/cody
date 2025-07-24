import type { SpanContext } from '@opentelemetry/api'

export function getTraceparentFromSpanContext(spanContext: SpanContext): string {
    return `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags
        .toString(16)
        .padStart(2, '0')}`
}
