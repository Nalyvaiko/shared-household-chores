import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEV_AUTH_SECRET,
  buildSteps,
  localDefaults,
  resolveEnv,
} from "../scripts/dev-all.mjs";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("dev:all environment", () => {
  it("leaves the environment alone when .env exists", () => {
    const env = { PATH: "/bin", DATABASE_URL: "postgresql://custom" };
    const result = resolveEnv({ env, envFileExists: true });
    expect(result.usingDefaults).toBe(false);
    expect(result.env).toEqual(env);
    expect(result.env).not.toHaveProperty("AUTH_SECRET");
  });

  it("injects the local defaults when there is no .env", () => {
    const result = resolveEnv({ env: { PATH: "/bin" }, envFileExists: false });
    const url = "postgresql://chores:chores@localhost:5432/chores?schema=public";
    expect(result.usingDefaults).toBe(true);
    expect(result.env).toEqual({
      PATH: "/bin",
      DATABASE_URL: url,
      DIRECT_URL: url,
      AUTH_URL: "http://localhost:3000",
      AUTH_TRUST_HOST: "true",
      AUTH_SECRET: DEV_AUTH_SECRET,
    });
  });

  it("lets variables already set in the shell win over the defaults", () => {
    const result = resolveEnv({
      env: { AUTH_URL: "http://localhost:3001", DATABASE_URL: "postgresql://x" },
      envFileExists: false,
    });
    expect(result.env.AUTH_URL).toBe("http://localhost:3001");
    expect(result.env.DATABASE_URL).toBe("postgresql://x");
    expect(result.env.DIRECT_URL).toContain("localhost:5432");
  });

  it("uses CHORES_DB_PORT in the default database URLs", () => {
    const defaults = localDefaults({ CHORES_DB_PORT: "55440" });
    expect(defaults.DATABASE_URL).toBe(
      "postgresql://chores:chores@localhost:55440/chores?schema=public",
    );
    expect(defaults.DIRECT_URL).toBe(defaults.DATABASE_URL);
  });

  it("matches the local defaults documented in .env.example", () => {
    const example = read(".env.example");
    const defaults = localDefaults({});
    for (const name of ["DATABASE_URL", "DIRECT_URL", "AUTH_URL"] as const) {
      expect(example).toContain(`${name}="${defaults[name]}"`);
    }
  });
});

describe("dev:all steps", () => {
  const steps = buildSteps({ root: "/repo", nodePath: "/usr/bin/node" });

  it("starts the database, migrates, seeds, then starts next dev", () => {
    expect(steps.map((step) => step.name)).toEqual([
      "Start Postgres",
      "Apply migrations",
      "Seed demo data",
      "Start dev server",
    ]);
  });

  it("waits for the compose database to be healthy", () => {
    expect(steps[0]).toEqual({
      name: "Start Postgres",
      command: "docker",
      args: ["compose", "up", "-d", "--wait", "db"],
    });
  });

  it("migrates without resetting and seeds only an unseeded database", () => {
    const [, migrate, seed] = steps;
    expect(migrate.command).toBe("/usr/bin/node");
    expect(migrate.args.slice(1)).toEqual(["migrate", "deploy"]);
    expect(seed.args.slice(1)).toEqual(["db", "seed", "--", "--skip-if-seeded"]);
    for (const step of steps) {
      expect(step.args.join(" ")).not.toMatch(/reset|--force|drop/);
    }
  });

  it("runs the local Prisma and Next.js CLIs through node", () => {
    expect(steps[1].args[0]).toBe(
      join("/repo", "node_modules", "prisma", "build", "index.js"),
    );
    expect(steps[3].args[0]).toBe(
      join("/repo", "node_modules", "next", "dist", "bin", "next"),
    );
  });

  it("passes extra arguments to next dev", () => {
    const [, , , dev] = buildSteps({
      root: "/repo",
      nodePath: "node",
      nextArgs: ["--port", "3001"],
    });
    expect(dev.args.slice(1)).toEqual(["dev", "--port", "3001"]);
  });
});

describe("dev:all wiring", () => {
  it("is exposed as an npm script", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["dev:all"]).toBe("node scripts/dev-all.mjs");
    expect(pkg.scripts.dev).toBe("next dev");
  });

  it("gives the compose database a pg_isready healthcheck and a port override", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/healthcheck:[\s\S]*pg_isready/);
    expect(compose).toContain('"${CHORES_DB_PORT:-5432}:5432"');
  });
});
