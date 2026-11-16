import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(join(__dirname, "..", ".github", "workflows", name), "utf8");

const ci = read("ci.yml");
const dev = read("deploy-dev.yml");
const prod = read("deploy-production.yml");

/** The top-level `on:` block, up to the next top-level key. */
const triggers = (workflow: string) =>
  workflow.match(/^on:\r?\n([\s\S]*?)^\S/m)?.[1] ?? "";

const indexIn = (workflow: string, text: string) => {
  const at = workflow.indexOf(text);
  expect(at, `workflow containing "${text}"`).toBeGreaterThan(-1);
  return at;
};

describe.each([
  ["deploy-dev.yml", dev],
  ["deploy-production.yml", prod],
])("%s (shared rules)", (_name, workflow) => {
  it("reads the Vercel secrets from GitHub secrets only", () => {
    expect(workflow).toContain("VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}");
    expect(workflow).toContain("VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}");
    expect(workflow).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    // Every CLI call authenticates with the token from the environment.
    const calls = workflow.match(/^\s*(?:run: |url=\$\()vercel (?:pull|build|deploy|alias)\b.*$/gm) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('--token="$VERCEL_TOKEN"');
  });

  it("fails fast with a clear message when a secret is missing", () => {
    const check = indexIn(workflow, "name: Check deploy secrets");
    expect(check).toBeLessThan(indexIn(workflow, "vercel pull"));
    expect(workflow).toContain("for name in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID");
    expect(workflow).toContain("::error::Missing repository secret(s)");
  });

  it("keeps permissions minimal and never overlaps deploys", () => {
    expect(workflow).toMatch(/^permissions:\r?\n {2}contents: read$/m);
    expect(workflow).not.toMatch(/: write$/m);
    expect(workflow).toMatch(/^concurrency:\r?\n {2}group: deploy-\w+\r?\n {2}cancel-in-progress: false$/m);
  });

  it("pins the runner, Node 24 with the npm cache, and the Vercel CLI", () => {
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).toContain("actions/setup-node@v7");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("cache: npm");
    expect(workflow).toMatch(/VERCEL_CLI_VERSION: \d+\.\d+\.\d+/);
    expect(workflow).toContain('npm install --global "vercel@$VERCEL_CLI_VERSION"');
  });

  it("pulls, builds, deploys prebuilt output, then runs the smoke tests", () => {
    const install = indexIn(workflow, "run: npm ci");
    const pull = indexIn(workflow, "vercel pull --yes");
    const build = indexIn(workflow, "vercel build");
    const deploy = indexIn(workflow, "vercel deploy --prebuilt");
    const chromium = indexIn(workflow, "npx playwright install --with-deps chromium");
    const smoke = indexIn(workflow, "run: npm run test:e2e:remote");
    expect(install).toBeLessThan(pull);
    expect(pull).toBeLessThan(build);
    expect(build).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(chromium);
    expect(chromium).toBeLessThan(smoke);
    expect(workflow).toContain("path: ~/.cache/ms-playwright");
  });

  it("never seeds", () => {
    expect(workflow).not.toMatch(/seed/);
  });
});

describe("deploy-dev.yml", () => {
  it("runs only after the CI workflow completes on main", () => {
    expect(ci).toMatch(/^name: CI$/m);
    const on = triggers(dev);
    expect(on).toMatch(/workflow_run:\r?\n\s+workflows: \["CI"\]\r?\n\s+types: \[completed\]\r?\n\s+branches: \[main\]/);
    expect(on).not.toMatch(/workflow_dispatch|push|pull_request/);
  });

  it("deploys only a successful CI run for a push to main in this repo", () => {
    expect(dev).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(dev).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(dev).toContain("github.event.workflow_run.event == 'push'");
    expect(dev).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    );
  });

  it("checks out the exact commit CI passed", () => {
    expect(dev).toMatch(/uses: actions\/checkout@v7\r?\n\s+with:\r?\n\s+ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  });

  it("uses the development environment and Vercel Preview settings", () => {
    expect(dev).toMatch(/environment:\r?\n\s+name: development\r?\n\s+url: https:\/\/shared-household-chores-dev\.vercel\.app/);
    expect(dev).toContain('vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"');
    expect(dev).not.toContain("--prod");
  });

  it("aliases the deployment to the dev URL and smoke-tests that URL", () => {
    expect(dev).toContain("DEV_ALIAS: shared-household-chores-dev.vercel.app");
    const alias = indexIn(dev, 'vercel alias set "${{ steps.deploy.outputs.url }}" "$DEV_ALIAS"');
    expect(indexIn(dev, "vercel deploy --prebuilt")).toBeLessThan(alias);
    expect(alias).toBeLessThan(indexIn(dev, "run: npm run test:e2e:remote"));
    expect(dev).toContain("E2E_BASE_URL: https://${{ env.DEV_ALIAS }}");
    expect(dev).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
  });
});

describe("deploy-production.yml", () => {
  it("runs only when started by hand, with a ref input defaulting to main", () => {
    const on = triggers(prod);
    expect(on).toMatch(/^ {2}workflow_dispatch:\r?\n/);
    expect(on).not.toMatch(/push|pull_request|workflow_run|schedule/);
    expect(on).toMatch(/ref:\r?\n[\s\S]*?default: main/);
  });

  it("deploys only a commit that is on main and passed CI", () => {
    expect(prod).toMatch(/^permissions:\r?\n {2}contents: read\r?\n {2}actions: read$/m);
    expect(prod).toContain('git merge-base --is-ancestor "$sha" origin/main');
    expect(prod).toContain('--workflow ci.yml --commit "$sha" --status success');
    expect(prod).toMatch(/deploy-production:\r?\n\s+needs: check/);
    expect(prod).toContain("ref: ${{ needs.check.outputs.sha }}");
    // The input reaches the shell through env, never interpolated into a script.
    const uses = prod.match(/^.*\$\{\{ inputs\.ref \}\}.*$/gm) ?? [];
    expect(uses.map((line) => line.trim())).toEqual([
      "ref: ${{ inputs.ref }}",
      "REF: ${{ inputs.ref }}",
    ]);
  });

  it("waits for approval in the production environment", () => {
    expect(prod).toMatch(/environment:\r?\n\s+name: production\r?\n\s+url: https:\/\/shared-household-chores\.vercel\.app/);
  });

  it("builds and deploys with the Vercel Production settings", () => {
    expect(prod).toContain('vercel pull --yes --environment=production --token="$VERCEL_TOKEN"');
    expect(prod).toContain('vercel build --prod --token="$VERCEL_TOKEN"');
    expect(prod).toContain('vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"');
    expect(prod).toContain("E2E_BASE_URL: ${{ env.PRODUCTION_URL }}");
    expect(prod).toContain("PRODUCTION_URL: https://shared-household-chores.vercel.app");
  });
});
