import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

import { scrubAttributes } from "@/lib/observability/privacy";

// Thin helpers over the OpenTelemetry API. With no SDK registered (telemetry
// off) every call here is a no-op.

export const SERVICE_NAME = "shared-household-chores";

export function tracer() {
  return trace.getTracer(SERVICE_NAME);
}

/**
 * Next.js signals `redirect()` and `notFound()` by throwing; those are control
 * flow, not failures.
 */
export function isNextControlFlow(error: unknown): boolean {
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? error.digest : undefined;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") ||
      digest === "DYNAMIC_SERVER_USAGE")
  );
}

/** The error's class name only; its message can quote user input. */
export function errorType(error: unknown): string {
  return error instanceof Error ? error.constructor.name || error.name : typeof error;
}

/** Marks the span failed without recording the error's message or stack. */
export function markSpanError(span: Span, error: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.setAttributes(scrubAttributes({ "error.type": errorType(error) }));
}

/** Sets attributes that pass the privacy allow-list; the rest are dropped. */
export function setSpanAttributes(span: Span, attributes: Attributes): void {
  span.setAttributes(scrubAttributes(attributes));
}

/**
 * Runs `work` in a child span of the active one. A thrown error marks the
 * span failed (unless it is a Next.js redirect) and is rethrown.
 */
export function inSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(
    name,
    { attributes: scrubAttributes(attributes) },
    async (span) => {
      try {
        return await work(span);
      } catch (error) {
        if (!isNextControlFlow(error)) markSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
