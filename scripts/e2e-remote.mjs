#!/usr/bin/env node
/**
 * `npm run test:e2e:remote` — run the Playwright specs in `e2e/` against an
 * already deployed app, e.g. production on Vercel:
 *
 *   E2E_BASE_URL=https://your-app.vercel.app npm run test:e2e:remote
 *
 * No local server is built or started (playwright.config.ts skips `webServer`
 * when E2E_BASE_URL is set) and no database URL is needed. Every spec signs up
 * its own users with unique `e2e-…@example.com` emails and creates its own
 * household, so a run never touches existing data; the users and households
 * it creates stay in that database. Extra arguments go to `playwright test`.
 *
 * Plain Node, no dependencies.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runStep } from "./dev-all.mjs";

const LABEL = "test:e2e:remote";

/**
 * The validated origin to test, or an error message.
 * @param {string | undefined} value
 * @returns {{ baseUrl: string } | { error: string }}
 */
export function parseBaseUrl(value) {
  if (!value) {
    return {
      error:
        "E2E_BASE_URL is not set. Run it as `E2E_BASE_URL=https://your-app.vercel.app npm run test:e2e:remote`.",
    };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: `E2E_BASE_URL is not a valid URL: ${value}` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: `E2E_BASE_URL must be an http(s) URL: ${value}` };
  }
  return { baseUrl: url.origin };
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const result = parseBaseUrl(process.env.E2E_BASE_URL);
  if ("error" in result) {
    console.error(`[${LABEL}] ${result.error}`);
    process.exit(1);
  }
  console.log(`[${LABEL}] Running the e2e specs against ${result.baseUrl}`);
  const playwright = join(root, "node_modules", "@playwright", "test", "cli.js");
  const code = await runStep(
    {
      name: "End-to-end tests",
      command: process.execPath,
      args: [playwright, "test", ...process.argv.slice(2)],
    },
    { cwd: root, env: { ...process.env, E2E_BASE_URL: result.baseUrl }, label: LABEL },
  );
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
