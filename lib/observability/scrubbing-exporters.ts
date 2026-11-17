import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-node";

import { looksSensitive, scrubAttributes, scrubSpanName } from "@/lib/observability/privacy";

type ExportCallback = Parameters<SpanExporter["export"]>[1];

// Wrappers that scrub every span and log record on its way to the real
// exporter, so nothing a library sets (Next.js, Prisma) skips the allow-list.

/** A copy of the span with only allowed attributes, a safe name and no error text. */
export function scrubSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: scrubSpanName(span.name),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    // The status message can hold an error's text; the code is enough.
    status: { code: span.status.code },
    attributes: scrubAttributes(span.attributes),
    links: span.links.map((link) => ({ ...link, attributes: scrubAttributes(link.attributes) })),
    // Exception events keep their name and `error.type`-like fields only:
    // `exception.message` and `exception.stacktrace` can quote user input.
    events: span.events.map((event) => ({
      name: event.name,
      time: event.time,
      attributes: scrubAttributes(event.attributes),
    })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

export class ScrubbingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: ExportCallback): void {
    this.inner.export(spans.map(scrubSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

/** A copy of the log record with only allowed attributes and a safe body. */
export function scrubLogRecord(record: ReadableLogRecord): ReadableLogRecord {
  const body =
    typeof record.body === "string" && !looksSensitive(record.body) ? record.body : undefined;
  return {
    hrTime: record.hrTime,
    hrTimeObserved: record.hrTimeObserved,
    spanContext: record.spanContext,
    severityText: record.severityText,
    severityNumber: record.severityNumber,
    body,
    eventName: record.eventName,
    resource: record.resource,
    instrumentationScope: record.instrumentationScope,
    attributes: scrubAttributes(record.attributes as Parameters<typeof scrubAttributes>[0]),
    droppedAttributesCount: record.droppedAttributesCount,
  };
}

export class ScrubbingLogRecordExporter implements LogRecordExporter {
  constructor(private readonly inner: LogRecordExporter) {}

  export(logs: ReadableLogRecord[], resultCallback: ExportCallback): void {
    this.inner.export(logs.map(scrubLogRecord), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }
}
