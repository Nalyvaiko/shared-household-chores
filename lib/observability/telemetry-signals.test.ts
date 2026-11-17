// @vitest-environment node
import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { traceCompleteChore } from "@/lib/observability/complete-chore-journey";
import { createLogger } from "@/lib/observability/logger";
import {
  ScrubbingLogRecordExporter,
  ScrubbingSpanExporter,
} from "@/lib/observability/scrubbing-exporters";
import { inSpan, tracer } from "@/lib/observability/telemetry";

// A real SDK wired like lib/observability/sdk.ts, with in-memory exporters
// behind the same scrubbing wrappers.

const spans = new InMemorySpanExporter();
const logRecords = new InMemoryLogRecordExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60_000,
});
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ScrubbingSpanExporter(spans))],
});
const loggerProvider = new LoggerProvider({
  processors: [
    new SimpleLogRecordProcessor({ exporter: new ScrubbingLogRecordExporter(logRecords) }),
  ],
});
const meterProvider = new MeterProvider({ readers: [reader] });

beforeAll(() => {
  tracerProvider.register();
  logs.setGlobalLoggerProvider(loggerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
});

afterAll(async () => {
  await Promise.all([
    tracerProvider.shutdown(),
    loggerProvider.shutdown(),
    meterProvider.shutdown(),
  ]);
  trace.disable();
  context.disable();
  propagation.disable();
  logs.disable();
  metrics.disable();
});

beforeEach(() => {
  spans.reset();
  logRecords.reset();
});

const SECRET_VALUES = [
  "alex@example.com",
  "Take out the bins",
  "hunter2hunter2",
  "authjs.session-token",
  "s3cr3t-invite-token",
  "postgresql://",
  "callbackUrl",
];

function expectNoSecrets(value: unknown) {
  const raw = JSON.stringify(value);
  for (const secret of SECRET_VALUES) expect(raw).not.toContain(secret);
}

describe("span exporter scrubbing", () => {
  it("exports a library span without customer data, credentials, query strings or error text", async () => {
    const span = tracer().startSpan("GET /invite/s3cr3t-invite-token?callbackUrl=%2F", {
      attributes: {
        "http.method": "GET",
        "http.target": "/invite/s3cr3t-invite-token?callbackUrl=%2F",
        "http.url": "http://localhost:3000/invite/s3cr3t-invite-token",
        "http.request.header.cookie": "authjs.session-token=abc",
        "http.request.header.authorization": "Bearer abc",
        "enduser.id": "alex@example.com",
        "chore.title": "Take out the bins",
        "db.statement": "SELECT 1 WHERE password = 'hunter2hunter2'",
        "db.connection_string": "postgresql://chores:chores@db/chores",
      },
    });
    span.recordException(new Error("Unique failed for alex@example.com"));
    span.setStatus({ code: 2, message: "Take out the bins" });
    span.end();

    const [exported] = spans.getFinishedSpans();
    expect(exported.name).toBe("GET /invite/[token]");
    expect(exported.attributes).toEqual({
      "http.method": "GET",
      "db.statement": "SELECT ? WHERE password = '?'",
    });
    expect(exported.status).toEqual({ code: 2 });
    expect(exported.events.map((e) => e.name)).toEqual(["exception"]);
    expectNoSecrets({
      name: exported.name,
      attributes: exported.attributes,
      events: exported.events,
      status: exported.status,
    });
  });
});

describe("logger", () => {
  it("puts the active span's trace_id and span_id on the stdout line and the OTel record", async () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line), level: () => "info" });

    let ids = { traceId: "", spanId: "" };
    await inSpan("test.parent", {}, async (span) => {
      ids = span.spanContext();
      log.info("chore.complete.attempted", "Chore completion attempted", {
        "chore.id": "clx0abc123def456ghi789jkl",
        "user.email": "alex@example.com",
        "chore.title": "Take out the bins",
        password: "hunter2hunter2",
      });
    });

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({
      level: "info",
      event: "chore.complete.attempted",
      message: "Chore completion attempted",
      service: "shared-household-chores",
      trace_id: ids.traceId,
      span_id: ids.spanId,
      "chore.id": "clx0abc123def456ghi789jkl",
    });
    expect(ids.traceId).toMatch(/^[0-9a-f]{32}$/);
    expectNoSecrets(line);

    const [record] = logRecords.getFinishedLogRecords();
    expect(record.spanContext?.traceId).toBe(ids.traceId);
    expect(record.spanContext?.spanId).toBe(ids.spanId);
    expect(record.attributes).toEqual({
      "chore.id": "clx0abc123def456ghi789jkl",
      "event.name": "chore.complete.attempted",
    });
    expectNoSecrets({ body: record.body, attributes: record.attributes });
  });

  it("has no trace ids outside a span, and honours the level", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line), level: () => "warn" });
    log.info("x.info", "dropped");
    log.warn("x.warn", "kept");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).not.toHaveProperty("trace_id");
  });

  it("writes nothing to stdout when silent, but still exports the record", () => {
    const lines: string[] = [];
    createLogger({ write: (line) => lines.push(line), level: () => "silent" }).info("x.y", "z");
    expect(lines).toEqual([]);
    expect(logRecords.getFinishedLogRecords().map((r) => r.eventName)).toEqual(["x.y"]);
  });
});

describe("complete-a-chore journey", () => {
  it("records the span, its outcome attributes, the metrics and the logs under one trace", async () => {
    const result = await traceCompleteChore(async (journey) => {
      journey.attempted("clx0abc123def456ghi789jkl");
      await inSpan("chores.complete.write", {}, async () => undefined);
      journey.finished({ kind: "completed", chore: { recurrence: "weekly" } });
      return "done";
    });
    expect(result).toBe("done");

    const finished = spans.getFinishedSpans();
    const parent = finished.find((s) => s.name === "chores.complete")!;
    const child = finished.find((s) => s.name === "chores.complete.write")!;
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(parent.attributes).toEqual({
      "chore.id": "clx0abc123def456ghi789jkl",
      "chore.outcome": "completed",
      "chore.recurrence": "weekly",
      "chore.rolled_over": true,
    });

    const events = logRecords.getFinishedLogRecords();
    expect(events.map((r) => r.eventName)).toEqual([
      "chore.complete.attempted",
      "chore.complete.succeeded",
      "chore.rollover.created",
    ]);
    for (const record of events) {
      expect(record.spanContext?.traceId).toBe(parent.spanContext().traceId);
    }

    await reader.forceFlush();
    const exported = metricExporter.getMetrics().at(-1)!;
    const byName = Object.fromEntries(
      exported.scopeMetrics.flatMap((s) => s.metrics).map((m) => [m.descriptor.name, m]),
    );
    expect(byName["chores.completions"].dataPoints).toEqual([
      expect.objectContaining({ attributes: { "chore.outcome": "completed" }, value: 1 }),
    ]);
    expect(byName["chores.rollovers"].dataPoints).toEqual([
      expect.objectContaining({ attributes: { "chore.recurrence": "weekly" }, value: 1 }),
    ]);
    expect(byName["chores.complete.duration"].descriptor.unit).toBe("ms");
  });

  it("marks the span failed with outcome error, without the error's message", async () => {
    await expect(
      traceCompleteChore(async (journey) => {
        journey.attempted("clx0abc123def456ghi789jkl");
        throw new Error("boom for alex@example.com");
      }),
    ).rejects.toThrow("boom");

    const parent = spans.getFinishedSpans().find((s) => s.name === "chores.complete")!;
    expect(parent.status).toEqual({ code: 2 });
    expect(parent.attributes).toMatchObject({ "chore.outcome": "error", "error.type": "Error" });
    expectNoSecrets(parent.attributes);
    expect(logRecords.getFinishedLogRecords().at(-1)?.eventName).toBe("chore.complete.failed");
  });

  it("treats a Next.js redirect as control flow, not an error", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/household/new;307;",
    });
    await expect(
      traceCompleteChore(async (journey) => {
        journey.finished({ kind: "caller-gone" });
        throw redirect;
      }),
    ).rejects.toBe(redirect);

    const parent = spans.getFinishedSpans().find((s) => s.name === "chores.complete")!;
    expect(parent.status.code).toBe(0);
    expect(parent.attributes["chore.outcome"]).toBe("caller-gone");
  });
});
