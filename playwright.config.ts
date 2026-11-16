import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke tests: a production build of the app against a real,
// migrated Postgres (DATABASE_URL / DIRECT_URL from the environment or `.env`).
//
// With E2E_BASE_URL set (`npm run test:e2e:remote`), the same specs run against
// that already deployed app instead and no local server is started.
const PORT = 3100;
const remoteBaseURL = process.env.E2E_BASE_URL;
const baseURL = remoteBaseURL || `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

// A deployment behind Vercel Deployment Protection (e.g. the dev deployment)
// answers 401 without this header. Sent only to a remote app, only when set.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const bypassHeaders =
  remoteBaseURL && bypassSecret
    ? { extraHTTPHeaders: { "x-vercel-protection-bypass": bypassSecret } }
    : {};

// Only pass the database URLs through when they are set; otherwise
// `next start` falls back to `.env`.
const databaseEnv = Object.fromEntries(
  (["DATABASE_URL", "DIRECT_URL"] as const)
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name] as string]),
);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...bypassHeaders,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: remoteBaseURL
    ? undefined
    : {
        // CI builds in an earlier step; locally build first so the server
        // always runs the current code.
        command: isCI
          ? `npm run start -- --port ${PORT}`
          : `npm run build && npm run start -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 300_000,
        env: {
          ...databaseEnv,
          AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-not-used-anywhere-else",
          AUTH_URL: baseURL,
          AUTH_TRUST_HOST: "true",
        },
      },
});
