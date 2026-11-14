#!/usr/bin/env node
/**
 * `npm run test:all` — every test layer with one command.
 *
 *   1. Start the Postgres service from docker-compose.yml and wait until its
 *      healthcheck passes (the same step as `npm run dev:all`).
 *   2. Create the `chores_test` database on that server if it is missing. The
 *      development database (`chores`) is never touched.
 *   3. Apply the committed migrations to `chores_test` (`prisma migrate deploy`).
 *   4. Run the unit tests, then the integration tests, then the Playwright
 *      end-to-end tests, all pointed at `chores_test`.
 *
 * Each step streams its output; the first failing step stops the run with its
 * exit code. A summary with each step's duration is printed at the end.
 *
 * `.env` is neither read for the database nor written: the steps get
 * DATABASE_URL / DIRECT_URL for `chores_test` in their environment, which
 * wins over `.env`.
 *
 * Overrides, as for `npm run dev:all`:
 *   COMPOSE_PROJECT_NAME  Docker Compose project (separate containers/volume)
 *   CHORES_DB_PORT        host port for Postgres (default 5432)
 *
 * Plain Node, no dependencies, works on Windows, macOS and Linux.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { dockerIsReachable, dockerNotRunning, runStep } from "./dev-all.mjs";

export const TEST_DATABASE = "chores_test";

/**
 * The connection string for the test database on the Compose server.
 * @param {Record<string, string | undefined>} env
 */
export function testDatabaseUrl(env) {
  const port = env.CHORES_DB_PORT || "5432";
  return `postgresql://chores:chores@localhost:${port}/${TEST_DATABASE}?schema=public`;
}

/**
 * The environment every step runs with: the shell's, with both database URLs
 * pointed at the test database (a shell DATABASE_URL never leaks through).
 * @param {Record<string, string | undefined>} env
 */
export function testEnv(env) {
  const url = testDatabaseUrl(env);
  return { ...env, DATABASE_URL: url, DIRECT_URL: url, TEST_DATABASE_URL: url };
}

/**
 * The steps, in order. Node-based CLIs are run through `node` directly (no
 * `npx`/`.cmd` shims), which keeps spawning identical on every platform.
 * @param {{ root: string, nodePath: string }} options
 * @returns {{ name: string, command: string, args: string[] }[]}
 */
export function buildSteps({ root, nodePath }) {
  const prisma = join(root, "node_modules", "prisma", "build", "index.js");
  const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
  const playwright = join(root, "node_modules", "@playwright", "test", "cli.js");
  return [
    {
      name: "Start Postgres",
      command: "docker",
      args: ["compose", "up", "-d", "--wait", "db"],
    },
    {
      name: `Create ${TEST_DATABASE} if missing`,
      command: nodePath,
      args: [fileURLToPath(import.meta.url), "--ensure-test-database"],
    },
    {
      name: `Apply migrations to ${TEST_DATABASE}`,
      command: nodePath,
      args: [prisma, "migrate", "deploy"],
    },
    { name: "Unit tests", command: nodePath, args: [vitest, "run"] },
    {
      name: "Integration tests",
      command: nodePath,
      args: [vitest, "run", "--config", "vitest.integration.config.mts"],
    },
    { name: "End-to-end tests", command: nodePath, args: [playwright, "test"] },
  ];
}

/** Run `psql` inside the Compose db container against the `chores` database. */
function psql(sql, env) {
  return spawnSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "chores", "-d", "chores", "-tAc", sql],
    { env, encoding: "utf8" },
  );
}

/** Creates the test database unless it exists. Exits non-zero on failure. */
function ensureTestDatabase(env) {
  const check = psql(`SELECT 1 FROM pg_database WHERE datname = '${TEST_DATABASE}'`, env);
  if (check.status !== 0) {
    process.stderr.write(check.stderr || check.error?.message || "psql failed\n");
    process.exit(check.status || 1);
  }
  if (check.stdout.trim() === "1") {
    console.log(`[test:all] ${TEST_DATABASE} already exists.`);
    return;
  }
  const create = psql(`CREATE DATABASE ${TEST_DATABASE}`, env);
  if (create.status !== 0) {
    process.stderr.write(create.stderr || create.error?.message || "psql failed\n");
    process.exit(create.status || 1);
  }
  console.log(`[test:all] Created ${TEST_DATABASE}.`);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const env = testEnv(process.env);

  if (process.argv.includes("--ensure-test-database")) {
    ensureTestDatabase(env);
    return;
  }

  if (!dockerIsReachable(env)) {
    console.error(`[test:all] ${dockerNotRunning("npm run test:all")}`);
    process.exit(1);
  }

  const results = [];
  for (const step of buildSteps({ root, nodePath: process.execPath })) {
    console.log(`\n[test:all] ${step.name}…`);
    const started = Date.now();
    const code = await runStep(step, { cwd: root, env, label: "test:all" });
    results.push(`  ${code === 0 ? "ok  " : "FAIL"} ${step.name} (${seconds(Date.now() - started)})`);
    if (code !== 0) {
      console.error(`\n[test:all] ${step.name} failed (exit code ${code}).`);
      console.error(results.join("\n"));
      process.exit(code);
    }
  }
  console.log(`\n[test:all] All steps passed.\n${results.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
