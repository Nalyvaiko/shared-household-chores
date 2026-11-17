import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { PrismaInstrumentation, registerInstrumentations } from "@prisma/instrumentation";

import {
  ScrubbingLogRecordExporter,
  ScrubbingSpanExporter,
} from "@/lib/observability/scrubbing-exporters";
import { SERVICE_NAME } from "@/lib/observability/telemetry";

// The OpenTelemetry SDK for the Node.js runtime. `instrumentation.ts` loads it
// only when OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise no provider is
// registered and every tracer, meter and logger stays a no-op.
//
// The OTLP/HTTP exporters read the standard variables themselves:
// OTEL_EXPORTER_OTLP_ENDPOINT (the base URL; /v1/traces, /v1/metrics and
// /v1/logs are appended) and OTEL_EXPORTER_OTLP_HEADERS (e.g. the
// Authorization header a hosted backend needs).

const STARTED = Symbol.for("shared-household-chores.telemetry-started");

export function deploymentEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEPLOYMENT_ENVIRONMENT || env.VERCEL_ENV || env.NODE_ENV || "development";
}

export function startTelemetry(): void {
  const globals = globalThis as { [STARTED]?: boolean };
  if (globals[STARTED]) return;
  globals[STARTED] = true;

  // Only these resource attributes: no host or process detectors, so the
  // command line and environment never ride along.
  const resource = resourceFromAttributes({
    "service.name": SERVICE_NAME,
    "deployment.environment.name": deploymentEnvironment(),
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new ScrubbingSpanExporter(new OTLPTraceExporter()))],
  });
  // Also installs the AsyncLocalStorage context manager and W3C propagation.
  tracerProvider.register();

  metrics.setGlobalMeterProvider(
    new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL) || 15_000,
        }),
      ],
    }),
  );

  logs.setGlobalLoggerProvider(
    new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor({
          exporter: new ScrubbingLogRecordExporter(new OTLPLogExporter()),
        }),
      ],
    }),
  );

  // Prisma's own spans (client operation, transaction, the SQL statement).
  registerInstrumentations({
    tracerProvider,
    instrumentations: [new PrismaInstrumentation()],
  });
}
