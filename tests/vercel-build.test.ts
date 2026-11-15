import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REQUIRED_BUILD_ENV,
  buildSteps,
  missingEnvMessage,
  resolveBuildEnv,
} from "../scripts/vercel-build.mjs";

const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// What the Vercel Marketplace Neon integration sets (no custom prefix).
const neon = {
  DATABASE_URL: "postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require",
  DATABASE_URL_UNPOOLED: "postgresql://u:p@ep-x.neon.tech/db?sslmode=require",
  POSTGRES_URL: "postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require",
  POSTGRES_PRISMA_URL: "postgresql://u:p@ep-x-pooler.neon.tech/db?pgbouncer=true",
  POSTGRES_URL_NON_POOLING: "postgresql://u:p@ep-x.neon.tech/db?sslmode=require",
};

describe("vercel-build", () => {
  it("is the Vercel build script", () => {
    expect(pkg.scripts["vercel-build"]).toBe("node scripts/vercel-build.mjs");
  });

  it("maps the Neon integration's names with no renaming", () => {
    const { env, sources, missing } = resolveBuildEnv({ ...neon, AUTH_SECRET: "s" });
    expect(missing).toEqual([]);
    expect(env.DATABASE_URL).toBe(neon.DATABASE_URL);
    expect(env.DIRECT_URL).toBe(neon.DATABASE_URL_UNPOOLED);
    expect(sources).toEqual({
      DATABASE_URL: "DATABASE_URL",
      DIRECT_URL: "DATABASE_URL_UNPOOLED",
    });
  });

  it("keeps explicitly set DATABASE_URL and DIRECT_URL", () => {
    const { env, sources } = resolveBuildEnv({
      ...neon,
      DATABASE_URL: "postgresql://mine-pooled",
      DIRECT_URL: "postgresql://mine-direct",
      AUTH_SECRET: "s",
    });
    expect(env.DATABASE_URL).toBe("postgresql://mine-pooled");
    expect(env.DIRECT_URL).toBe("postgresql://mine-direct");
    expect(sources).toEqual({ DATABASE_URL: "DATABASE_URL", DIRECT_URL: "DIRECT_URL" });
  });

  it("falls back to the legacy POSTGRES_* names", () => {
    const { env, missing } = resolveBuildEnv({
      POSTGRES_PRISMA_URL: neon.POSTGRES_PRISMA_URL,
      POSTGRES_URL: neon.POSTGRES_URL,
      POSTGRES_URL_NON_POOLING: neon.POSTGRES_URL_NON_POOLING,
      AUTH_SECRET: "s",
    });
    expect(missing).toEqual([]);
    expect(env.DATABASE_URL).toBe(neon.POSTGRES_PRISMA_URL);
    expect(env.DIRECT_URL).toBe(neon.POSTGRES_URL_NON_POOLING);

    expect(resolveBuildEnv({ POSTGRES_URL: "postgresql://legacy" }).env.DATABASE_URL).toBe(
      "postgresql://legacy",
    );
  });

  it("treats empty values as missing", () => {
    const { env, missing } = resolveBuildEnv({
      DATABASE_URL: "",
      POSTGRES_URL: "postgresql://legacy",
      DIRECT_URL: "",
      AUTH_SECRET: "",
    });
    expect(env.DATABASE_URL).toBe("postgresql://legacy");
    expect(missing).toEqual(["DIRECT_URL", "AUTH_SECRET"]);
  });

  it("does not change the input environment", () => {
    const input = { DATABASE_URL_UNPOOLED: "postgresql://direct" };
    resolveBuildEnv(input);
    expect(input).toEqual({ DATABASE_URL_UNPOOLED: "postgresql://direct" });
  });

  it("names every missing variable and its accepted sources on one line", () => {
    const { missing } = resolveBuildEnv({ PATH: "/bin" });
    expect(missing).toEqual(REQUIRED_BUILD_ENV);
    const message = missingEnvMessage(missing);
    expect(message).not.toContain("\n");
    expect(message).toContain("DATABASE_URL (or POSTGRES_PRISMA_URL / POSTGRES_URL)");
    expect(message).toContain("DIRECT_URL (or DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING)");
    expect(message).toMatch(/AUTH_SECRET\./);
  });

  it("migrates, then builds — and never seeds", () => {
    const steps = buildSteps({ root: "/repo", nodePath: "/usr/bin/node" });
    expect(steps.map((step) => step.name)).toEqual(["Apply migrations", "Build"]);
    expect(steps[0].args.slice(1)).toEqual(["migrate", "deploy"]);
    expect(steps[0].args[0]).toMatch(/node_modules[\\/]prisma[\\/]build[\\/]index\.js$/);
    expect(steps[1].args.slice(1)).toEqual(["build"]);
    expect(steps[1].args[0]).toMatch(/node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next$/);
    for (const step of steps) {
      expect(step.command).toBe("/usr/bin/node");
      expect(step.args.join(" ")).not.toMatch(/seed|reset/);
    }
    expect(readFileSync(join(root, "scripts", "vercel-build.mjs"), "utf8")).not.toMatch(
      /db seed|seed\.ts/,
    );
  });
});
