#!/usr/bin/env node
/**
 * `npm run dev:all` — run the whole app locally with one command.
 *
 *   1. Start the Postgres service from docker-compose.yml and wait until its
 *      healthcheck passes (`docker compose up -d --wait db`).
 *   2. Apply the committed migrations (`prisma migrate deploy` — never resets
 *      or drops data).
 *   3. Seed the demo data, but only into a database that has not been seeded
 *      yet (`prisma db seed -- --skip-if-seeded`), so a re-run never rewrites
 *      demo rows you have changed.
 *   4. Start `next dev`. Extra arguments go to it:
 *      `npm run dev:all -- --port 3001`.
 *
 * Each step streams its output; the first failing step stops the run with its
 * exit code.
 *
 * Environment: if `.env` exists, the steps read it as usual. If it does not,
 * the local defaults from `.env.example` are injected into the child
 * processes' environment (`.env` is never written). Variables already set in
 * the shell always win.
 *
 * Overrides (e.g. to run a second, throwaway stack next to your usual one):
 *   COMPOSE_PROJECT_NAME  Docker Compose project (separate containers/volume)
 *   CHORES_DB_PORT        host port for Postgres (default 5432); also used in
 *                         the default DATABASE_URL / DIRECT_URL
 *
 * Plain Node, no dependencies, works on Windows, macOS and Linux.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_DB_PORT = "5432";

/** Dev-only secret, used only when there is no `.env`. Never use it elsewhere. */
export const DEV_AUTH_SECRET = "dev-all-local-only-secret-do-not-use-in-production";

/**
 * Local defaults from `.env.example`, for the bundled Compose database.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function localDefaults(env) {
  const port = env.CHORES_DB_PORT || DEFAULT_DB_PORT;
  const url = `postgresql://chores:chores@localhost:${port}/chores?schema=public`;
  return {
    DATABASE_URL: url,
    DIRECT_URL: url,
    AUTH_SECRET: DEV_AUTH_SECRET,
    AUTH_URL: "http://localhost:3000",
    AUTH_TRUST_HOST: "true",
  };
}

/**
 * The environment the steps run with.
 * @param {{ env: Record<string, string | undefined>, envFileExists: boolean }} options
 * @returns {{ env: Record<string, string | undefined>, usingDefaults: boolean }}
 */
export function resolveEnv({ env, envFileExists }) {
  if (envFileExists) return { env: { ...env }, usingDefaults: false };
  return { env: { ...localDefaults(env), ...env }, usingDefaults: true };
}

/**
 * The steps, in order. Node-based CLIs are run through `node` directly (no
 * `npx`/`.cmd` shims), which keeps spawning identical on every platform.
 * @param {{ root: string, nodePath: string, nextArgs?: string[] }} options
 * @returns {{ name: string, command: string, args: string[] }[]}
 */
export function buildSteps({ root, nodePath, nextArgs = [] }) {
  const prisma = join(root, "node_modules", "prisma", "build", "index.js");
  const next = join(root, "node_modules", "next", "dist", "bin", "next");
  return [
    {
      name: "Start Postgres",
      command: "docker",
      args: ["compose", "up", "-d", "--wait", "db"],
    },
    {
      name: "Apply migrations",
      command: nodePath,
      args: [prisma, "migrate", "deploy"],
    },
    {
      name: "Seed demo data",
      command: nodePath,
      args: [prisma, "db", "seed", "--", "--skip-if-seeded"],
    },
    {
      name: "Start dev server",
      command: nodePath,
      args: [next, "dev", ...nextArgs],
    },
  ];
}

export const DOCKER_NOT_RUNNING =
  "Docker is not reachable. Start Docker Desktop (or the Docker daemon) and run `npm run dev:all` again.";

/** True when the Docker CLI is installed and its daemon answers. */
function dockerIsReachable(env) {
  const result = spawnSync("docker", ["info"], { stdio: "ignore", env });
  return !result.error && result.status === 0;
}

/** Run one step with inherited stdio; resolve with its exit code. */
function runStep(step, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, { cwd, env, stdio: "inherit" });
    // Ctrl+C reaches the child directly (same process group); keep this
    // process alive until the child has exited so its exit code is reported.
    const ignore = () => {};
    process.on("SIGINT", ignore);
    process.on("SIGTERM", ignore);
    const done = (code) => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", ignore);
      resolve(code);
    };
    child.on("error", (error) => {
      console.error(`[dev:all] ${step.name}: ${error.message}`);
      done(1);
    });
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { env, usingDefaults } = resolveEnv({
    env: process.env,
    envFileExists: existsSync(join(root, ".env")),
  });
  if (usingDefaults) {
    console.log("[dev:all] No .env found — using the local defaults from .env.example.");
  }

  if (!dockerIsReachable(env)) {
    console.error(`[dev:all] ${DOCKER_NOT_RUNNING}`);
    process.exit(1);
  }

  const steps = buildSteps({
    root,
    nodePath: process.execPath,
    nextArgs: process.argv.slice(2),
  });
  for (const step of steps) {
    console.log(`[dev:all] ${step.name}…`);
    const code = await runStep(step, { cwd: root, env });
    if (code !== 0) {
      console.error(`[dev:all] ${step.name} failed (exit code ${code}).`);
      process.exit(code);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
