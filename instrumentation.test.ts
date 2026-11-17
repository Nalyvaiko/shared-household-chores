import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startTelemetry } = vi.hoisted(() => ({ startTelemetry: vi.fn() }));
vi.mock("./lib/observability/sdk", () => ({ startTelemetry }));

import { register } from "./instrumentation";

describe("instrumentation register()", () => {
  beforeEach(() => startTelemetry.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("starts nothing when no OTLP endpoint is set (tests, CI, deployments without a backend)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    await register();
    expect(startTelemetry).not.toHaveBeenCalled();
  });

  it("starts nothing in the Edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    await register();
    expect(startTelemetry).not.toHaveBeenCalled();
  });

  it("starts the Node SDK when an endpoint is set", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    await register();
    expect(startTelemetry).toHaveBeenCalledOnce();
  });
});
