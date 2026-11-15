import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseBaseUrl } from "../scripts/e2e-remote.mjs";

const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

async function loadPlaywrightConfig() {
  vi.resetModules();
  return (await import("../playwright.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test:e2e:remote", () => {
  it("is wired up next to test:e2e", () => {
    expect(pkg.scripts["test:e2e:remote"]).toBe("node scripts/e2e-remote.mjs");
    expect(pkg.scripts["test:e2e"]).toBe("playwright test");
  });

  it("requires E2E_BASE_URL with a clear message", () => {
    expect(parseBaseUrl(undefined)).toEqual({
      error: expect.stringContaining("E2E_BASE_URL is not set"),
    });
    expect(parseBaseUrl("")).toEqual({ error: expect.stringContaining("E2E_BASE_URL is not set") });
    expect(parseBaseUrl("not a url")).toEqual({
      error: expect.stringContaining("not a valid URL"),
    });
    expect(parseBaseUrl("ftp://example.com")).toEqual({
      error: expect.stringContaining("http(s)"),
    });
  });

  it("uses the origin of E2E_BASE_URL", () => {
    expect(parseBaseUrl("https://chores.vercel.app/")).toEqual({
      baseUrl: "https://chores.vercel.app",
    });
  });

  it("skips the local web server when E2E_BASE_URL is set", async () => {
    vi.stubEnv("E2E_BASE_URL", "https://chores.vercel.app");
    const config = await loadPlaywrightConfig();
    expect(config.use?.baseURL).toBe("https://chores.vercel.app");
    expect(config.webServer).toBeUndefined();
  });

  it("starts the local production server otherwise", async () => {
    vi.stubEnv("E2E_BASE_URL", "");
    const config = await loadPlaywrightConfig();
    expect(config.use?.baseURL).toBe("http://localhost:3100");
    expect(config.webServer).toMatchObject({ url: "http://localhost:3100" });
  });
});
