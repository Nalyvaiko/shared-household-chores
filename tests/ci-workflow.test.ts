import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(__dirname, "..", ".github", "workflows", "ci.yml"),
  "utf8",
);

const stepIndex = (run: string) => {
  const index = workflow.indexOf(run);
  expect(index, `step running "${run}"`).toBeGreaterThan(-1);
  return index;
};

describe("CI workflow", () => {
  it("starts a Postgres 16 service with a health check", () => {
    expect(workflow).toMatch(/services:\s*\n\s*postgres:\s*\n\s*image: postgres:16/);
    expect(workflow).toContain("--health-cmd");
  });

  it("points DATABASE_URL and DIRECT_URL at the service", () => {
    expect(workflow).toMatch(/DATABASE_URL: postgresql:\/\/\S+@localhost:5432\//);
    expect(workflow).toMatch(/DIRECT_URL: postgresql:\/\/\S+@localhost:5432\//);
  });

  it("keeps the npm cache", () => {
    expect(workflow).toContain("cache: npm");
  });

  it("migrates and checks for drift after install and before typecheck", () => {
    const install = stepIndex("npm ci");
    const deploy = stepIndex("npx prisma migrate deploy");
    const diff = stepIndex("npx prisma migrate diff");
    const typecheck = stepIndex("npm run typecheck");
    expect(install).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(diff);
    expect(diff).toBeLessThan(typecheck);
    expect(workflow).toContain("--to-schema-datamodel prisma/schema.prisma");
    expect(workflow).toContain("--exit-code");
  });

  it("still runs lint, typecheck, test and build", () => {
    for (const run of [
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build",
    ]) {
      stepIndex(run);
    }
  });

  it("never runs the seed", () => {
    expect(workflow).not.toMatch(/seed/);
  });
});
