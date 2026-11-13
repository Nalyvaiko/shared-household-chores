import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke tests: a production build of the app against a real,
// migrated Postgres (DATABASE_URL / DIRECT_URL from the environment or `.env`).
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI builds in an earlier step; locally build first so the server always
    // runs the current code.
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
