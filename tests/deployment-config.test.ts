import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

describe("deployment configuration", () => {
  it("points the Prisma datasource at DATABASE_URL and DIRECT_URL", () => {
    const datasource = read("prisma/schema.prisma").match(
      /datasource db \{([^}]*)\}/,
    )?.[1];
    expect(datasource).toBeDefined();
    expect(datasource).toMatch(/\burl\s*=\s*env\("DATABASE_URL"\)/);
    expect(datasource).toMatch(/\bdirectUrl\s*=\s*env\("DIRECT_URL"\)/);
  });

  it("generates the Prisma client on install", () => {
    expect(pkg.scripts.postinstall).toBe("prisma generate");
  });

  it("applies migrations before next build in the Vercel build only", () => {
    // scripts/vercel-build.mjs: `prisma migrate deploy`, then `next build`
    // (its steps are covered in tests/vercel-build.test.ts).
    expect(pkg.scripts["vercel-build"]).toBe("node scripts/vercel-build.mjs");
    // CI migrates in its own step, so `npm run build` must not migrate.
    expect(pkg.scripts.build).toBe("next build");
  });

  it("never runs the seed as part of install or build", () => {
    for (const name of ["postinstall", "build", "vercel-build"]) {
      expect(pkg.scripts[name]).not.toMatch(/seed/);
    }
  });

  it("lets Vercel deploy only main from Git", () => {
    const vercel = JSON.parse(read("vercel.json")) as {
      git?: { deploymentEnabled?: unknown };
    };
    // Minimatch: "**" also matches branch names with "/" (feat/…), and a
    // branch matching both rules deploys when either is true, so main still
    // deploys to production.
    expect(vercel.git?.deploymentEnabled).toEqual({ main: true, "**": false });
  });

  it("documents every deploy variable in .env.example and the README", () => {
    const envExample = read(".env.example");
    const readme = read("README.md");
    for (const name of [
      "DATABASE_URL",
      "DIRECT_URL",
      "AUTH_SECRET",
      "AUTH_URL",
      "AUTH_TRUST_HOST",
    ]) {
      expect(envExample).toContain(name);
      expect(readme).toContain(`\`${name}\``);
    }
    expect(envExample).toContain("AUTH_TRUST_HOST=true");
  });
});
