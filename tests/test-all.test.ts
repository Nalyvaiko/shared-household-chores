import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DOCKER_NOT_RUNNING, dockerNotRunning } from "../scripts/dev-all.mjs";
import { buildSteps, testDatabaseUrl, testEnv } from "../scripts/test-all.mjs";

const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("test:all", () => {
  it("is wired up next to the per-layer scripts", () => {
    expect(pkg.scripts["test:all"]).toBe("node scripts/test-all.mjs");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts["test:unit"]).toBe("vitest run");
    expect(pkg.scripts["test:integration"]).toBe(
      "vitest run --config vitest.integration.config.mts",
    );
  });

  it("points every step at chores_test on the Compose port", () => {
    expect(testDatabaseUrl({})).toBe(
      "postgresql://chores:chores@localhost:5432/chores_test?schema=public",
    );
    const env = testEnv({
      CHORES_DB_PORT: "55441",
      DATABASE_URL: "postgresql://chores:chores@localhost:5432/chores",
      PATH: "/bin",
    });
    const url = "postgresql://chores:chores@localhost:55441/chores_test?schema=public";
    expect(env).toEqual({
      CHORES_DB_PORT: "55441",
      PATH: "/bin",
      DATABASE_URL: url,
      DIRECT_URL: url,
      TEST_DATABASE_URL: url,
    });
  });

  it("starts the database, migrates it, then runs unit, integration and e2e in order", () => {
    const steps = buildSteps({ root: "/repo", nodePath: "/usr/bin/node" });
    expect(steps.map((step) => step.name)).toEqual([
      "Start Postgres",
      "Create chores_test if missing",
      "Apply migrations to chores_test",
      "Unit tests",
      "Integration tests",
      "End-to-end tests",
    ]);
    expect(steps[0]).toMatchObject({
      command: "docker",
      args: ["compose", "up", "-d", "--wait", "db"],
    });
    expect(steps[2].args.slice(1)).toEqual(["migrate", "deploy"]);
    expect(steps[4].args.slice(1)).toEqual([
      "run",
      "--config",
      "vitest.integration.config.mts",
    ]);
    expect(steps[5].args.slice(1)).toEqual(["test"]);
    // Never resets, seeds or drops anything.
    const all = steps.flatMap((step) => step.args).join(" ");
    expect(all).not.toMatch(/reset|seed|drop/i);
  });

  it("names the command to re-run when Docker is not reachable", () => {
    expect(dockerNotRunning("npm run test:all")).toContain("`npm run test:all`");
    expect(DOCKER_NOT_RUNNING).toContain("`npm run dev:all`");
  });
});
