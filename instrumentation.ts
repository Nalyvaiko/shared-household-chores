// Runs once when a Next.js server starts. Telemetry is opt-in: with no
// OTEL_EXPORTER_OTLP_ENDPOINT nothing is registered, nothing is exported and
// no connection is made (tests, CI and deployments without a backend). The
// SDK is Node-only, so the Edge runtime never loads it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const { startTelemetry } = await import("./lib/observability/sdk");
  startTelemetry();
}
