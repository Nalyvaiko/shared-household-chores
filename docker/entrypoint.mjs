/**
 * Container entrypoint for the app image (see Dockerfile).
 *
 *   1. Apply the committed migrations (`prisma migrate deploy`: never resets or
 *      drops data).
 *   2. Seed the demo data, but only into a database that has not been seeded
 *      yet (`prisma/seed.ts --skip-if-seeded`), so a restart never rewrites
 *      rows you have changed.
 *   3. Start the Next.js standalone server (`server.js`) in this process. It
 *      listens on $PORT (3000) and $HOSTNAME (0.0.0.0), both set in the image.
 *
 * The first failing step stops the container with a clear message and that
 * step's exit code; Compose's restart policy then retries the whole sequence.
 *
 * Needs DATABASE_URL, DIRECT_URL and AUTH_SECRET (docker-compose.yml sets
 * them). Plain Node, no dependencies.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LABEL = "entrypoint";

/** Variables the steps and the server cannot run without. */
export const REQUIRED_ENV = ["DATABASE_URL", "DIRECT_URL", "AUTH_SECRET"];

/** Names of required variables that are unset or empty. */
export function missingEnv(env) {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

/**
 * The steps run before the server starts, in order.
 * @param {{ root: string, nodePath: string, prismaCli: string }} options
 * @returns {{ name: string, command: string, args: string[] }[]}
 */
export function buildSteps({ root, nodePath, prismaCli }) {
  return [
    {
      name: "Apply migrations",
      command: nodePath,
      args: [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        join(root, "prisma", "schema.prisma"),
      ],
    },
    {
      name: "Seed demo data (only if not seeded yet)",
      command: nodePath,
      args: [join(root, "prisma", "seed.ts"), "--skip-if-seeded"],
    },
  ];
}

/** Run one step with inherited stdio; resolve with its exit code. */
function runStep(step, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, { cwd, env, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`[${LABEL}] ${step.name}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");

  const missing = missingEnv(process.env);
  if (missing.length > 0) {
    console.error(
      `[${LABEL}] Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set them in docker-compose.yml or with `docker run -e`.",
    );
    process.exit(1);
  }

  const steps = buildSteps({
    root,
    nodePath: process.execPath,
    prismaCli:
      process.env.PRISMA_CLI ??
      join(root, "node_modules", "prisma", "build", "index.js"),
  });
  for (const step of steps) {
    console.log(`[${LABEL}] ${step.name}…`);
    const code = await runStep(step, { cwd: root, env: process.env });
    if (code !== 0) {
      console.error(
        `[${LABEL}] ${step.name} failed (exit code ${code}). The server was not started.`,
      );
      process.exit(code);
    }
  }

  console.log(`[${LABEL}] Starting the server on port ${process.env.PORT ?? 3000}…`);
  await import(pathToFileURL(join(root, "server.js")).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
