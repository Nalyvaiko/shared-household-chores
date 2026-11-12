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
  it("pins the runner image instead of following ubuntu-latest", () => {
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).not.toContain("ubuntu-latest");
  });

  it("starts a Postgres 16 service with a health check", () => {
    expect(workflow).toMatch(/services:\s*\n\s*postgres:\s*\n\s*image: postgres:16/);
    expect(workflow).toContain("--health-cmd");
  });

  it("points DATABASE_URL and DIRECT_URL at the service", () => {
    expect(workflow).toMatch(/DATABASE_URL: postgresql:\/\/\S+@localhost:5432\//);
    expect(workflow).toMatch(/DIRECT_URL: postgresql:\/\/\S+@localhost:5432\//);
  });

  it("uses action majors that run on Node 24", () => {
    expect(workflow).toContain("actions/checkout@v7");
    expect(workflow).toContain("actions/setup-node@v7");
    expect(workflow).toContain("node-version: 24");
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

  it("runs the Chromium end-to-end tests after the build", () => {
    const build = stepIndex("npm run build");
    const install = stepIndex("npx playwright install --with-deps chromium");
    const e2e = stepIndex("npm run test:e2e");
    expect(build).toBeLessThan(install);
    expect(install).toBeLessThan(e2e);
    expect(workflow).toContain("npx playwright install-deps chromium");
    expect(workflow).toContain("path: ~/.cache/ms-playwright");
  });

  it("uploads the Playwright report only when the job fails", () => {
    const e2e = stepIndex("npm run test:e2e");
    const upload = stepIndex("actions/upload-artifact@v7");
    expect(e2e).toBeLessThan(upload);
    expect(workflow).toMatch(/if: failure\(\)\s*\n\s*uses: actions\/upload-artifact@v7/);
    expect(workflow).toContain("playwright-report/");
  });

  it("never runs the seed", () => {
    expect(workflow).not.toMatch(/seed/);
  });
});
