#!/usr/bin/env node
/**
 * `npm run vercel-build` — the build Vercel runs on every deployment.
 *
 *   1. Resolve the database variables Prisma reads (see `resolveBuildEnv`), so
 *      the names the Vercel Marketplace Neon integration sets work as-is.
 *   2. Stop with one clear line if a required variable is missing.
 *   3. Apply the committed migrations (`prisma migrate deploy` — never resets
 *      or drops data).
 *   4. `next build`.
 *
 * The first failing step stops the build with its exit code. The seed never
 * runs here.
 *
 * Plain Node, no dependencies.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runStep } from "./dev-all.mjs";

const LABEL = "vercel-build";

/**
 * Where each variable Prisma reads may come from, in order of preference. The
 * first non-empty name wins. Our own names come first; the rest are what the
 * Neon integration on the Vercel Marketplace sets (`DATABASE_URL` pooled,
 * `DATABASE_URL_UNPOOLED` direct) plus its legacy `POSTGRES_*` names.
 */
export const DATABASE_ENV_SOURCES = {
  DATABASE_URL: ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"],
  DIRECT_URL: ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"],
};

/** Variables the build cannot run without, after resolution. */
export const REQUIRED_BUILD_ENV = ["DATABASE_URL", "DIRECT_URL", "AUTH_SECRET"];

/**
 * The environment for `prisma migrate deploy` and `next build`.
 *
 * Returns the input environment with `DATABASE_URL` and `DIRECT_URL` filled in
 * from the first non-empty source name, which name each one came from, and the
 * required variables that are still missing (never the values).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{
 *   env: Record<string, string | undefined>,
 *   sources: Record<string, string>,
 *   missing: string[],
 * }}
 */
export function resolveBuildEnv(env) {
  const resolved = { ...env };
  /** @type {Record<string, string>} */
  const sources = {};
  for (const [target, names] of Object.entries(DATABASE_ENV_SOURCES)) {
    const source = names.find((name) => env[name]);
    if (source) {
      resolved[target] = env[source];
      sources[target] = source;
    }
  }
  const missing = REQUIRED_BUILD_ENV.filter((name) => !resolved[name]);
  return { env: resolved, sources, missing };
}

/** The one-line message for missing variables, naming the accepted sources. */
export function missingEnvMessage(missing) {
  const details = missing.map((name) => {
    const names = DATABASE_ENV_SOURCES[name];
    return names ? `${name} (or ${names.slice(1).join(" / ")})` : name;
  });
  return (
    `Missing required environment variable(s): ${details.join(", ")}. ` +
    "Set them in the Vercel project (Settings → Environment Variables) and redeploy."
  );
}

/**
 * The steps, in order. Node-based CLIs are run through `node` directly.
 * @param {{ root: string, nodePath: string }} options
 * @returns {{ name: string, command: string, args: string[] }[]}
 */
export function buildSteps({ root, nodePath }) {
  const prisma = join(root, "node_modules", "prisma", "build", "index.js");
  const next = join(root, "node_modules", "next", "dist", "bin", "next");
  return [
    { name: "Apply migrations", command: nodePath, args: [prisma, "migrate", "deploy"] },
    { name: "Build", command: nodePath, args: [next, "build"] },
  ];
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { env, sources, missing } = resolveBuildEnv(process.env);

  if (missing.length > 0) {
    console.error(`[${LABEL}] ${missingEnvMessage(missing)}`);
    process.exit(1);
  }
  for (const [target, source] of Object.entries(sources)) {
    console.log(`[${LABEL}] ${target} from ${source}`);
  }

  for (const step of buildSteps({ root, nodePath: process.execPath })) {
    console.log(`[${LABEL}] ${step.name}…`);
    const code = await runStep(step, { cwd: root, env, label: LABEL });
    if (code !== 0) {
      console.error(`[${LABEL}] ${step.name} failed (exit code ${code}).`);
      process.exit(code);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
