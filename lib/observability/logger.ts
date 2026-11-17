import { isSpanContextValid, trace, type Attributes } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

import { scrubAttributes } from "@/lib/observability/privacy";
import { SERVICE_NAME } from "@/lib/observability/telemetry";

// Structured logs: one JSON line per event on stdout, and the same record
// through the OpenTelemetry logs API (a no-op unless telemetry is on). Inside
// a span both carry its trace_id and span_id, so a log line leads to its
// trace and back. Fields go through the privacy allow-list; the message is a
// fixed string chosen by the caller, never user input.

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export type LoggerOptions = {
  /** Where a JSON line goes. Default: stdout. */
  write?: (line: string) => void;
  /**
   * The lowest level logged. Default: LOG_LEVEL, else `info`. `silent` turns
   * off the stdout line only (the tests use it); records still go to
   * OpenTelemetry at `info` and above when telemetry is on.
   */
  level?: () => string | undefined;
};

export type Logger = Record<
  LogLevel,
  (event: string, message: string, fields?: Attributes) => void
>;

export function createLogger({
  write = (line) => process.stdout.write(`${line}\n`),
  level = () => process.env.LOG_LEVEL,
}: LoggerOptions = {}): Logger {
  function log(lvl: LogLevel, event: string, message: string, fields?: Attributes) {
    const threshold = level();
    const min = threshold && threshold in RANK ? RANK[threshold as keyof typeof RANK] : RANK.info;
    const toStdout = RANK[lvl] >= min;
    const toTelemetry = RANK[lvl] >= (threshold === "silent" ? RANK.info : min);
    if (!toStdout && !toTelemetry) return;

    const clean = scrubAttributes(fields);
    const spanContext = trace.getActiveSpan()?.spanContext();
    const ids =
      spanContext && isSpanContextValid(spanContext)
        ? { trace_id: spanContext.traceId, span_id: spanContext.spanId }
        : {};

    if (toStdout) {
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level: lvl,
          service: SERVICE_NAME,
          event,
          message,
          ...ids,
          ...clean,
        }),
      );
    }

    // The SDK takes the trace context from the active span itself.
    if (toTelemetry) {
      logs.getLogger(SERVICE_NAME).emit({
        severityNumber: SEVERITY[lvl],
        severityText: lvl.toUpperCase(),
        eventName: event,
        body: message,
        attributes: { ...clean, "event.name": event },
      });
    }
  }

  return {
    debug: (event, message, fields) => log("debug", event, message, fields),
    info: (event, message, fields) => log("info", event, message, fields),
    warn: (event, message, fields) => log("warn", event, message, fields),
    error: (event, message, fields) => log("error", event, message, fields),
  };
}

export const logger = createLogger();
