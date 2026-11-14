import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REQUIRED_ENV,
  buildSteps,
  missingEnv,
} from "../docker/entrypoint.mjs";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const dockerfile = read("Dockerfile");
const compose = read("docker-compose.yml");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

/** The text of one top-level Compose service, up to the next one. */
const service = (name: string) => {
  const start = compose.search(new RegExp(`^ {2}${name}:`, "m"));
  expect(start, `service ${name}`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const end = rest.search(/^ {2}\S|^\S/m);
  return end === -1 ? rest : rest.slice(0, end);
};

describe("Dockerfile", () => {
  it("builds on Debian-slim Node 24, not Alpine", () => {
    expect(dockerfile).toContain("node:24-bookworm-slim");
    expect(dockerfile).not.toMatch(/^(ARG|FROM)\b.*alpine/im);
  });

  it("installs from the lockfile and builds standalone output", () => {
    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toContain("NEXT_OUTPUT_STANDALONE=1");
    expect(dockerfile).toContain("COPY --from=builder /app/.next/standalone ./");
    expect(dockerfile).toContain("COPY --from=builder /app/.next/static ./.next/static");
  });

  it("ships what migrations and the seed need", () => {
    expect(dockerfile).toContain("COPY prisma ./prisma");
    expect(dockerfile).toContain("COPY lib/builtin-categories.ts");
    expect(dockerfile).toContain("COPY package.json ./package.json");
    expect(dockerfile).toMatch(/prisma@\$\{version\}/);
  });

  it("runs as a non-root user through the entrypoint on 0.0.0.0:3000", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain("HOSTNAME=0.0.0.0");
    expect(dockerfile).toContain("PORT=3000");
    expect(dockerfile).toContain('ENTRYPOINT ["node", "docker/entrypoint.mjs"]');
  });
});

describe("docker-compose.yml", () => {
  it("keeps the db service that dev:all and test:all start by name", () => {
    const db = service("db");
    expect(db).toContain("image: postgres:16");
    expect(db).toContain('"${CHORES_DB_PORT:-5432}:5432"');
    expect(db).toContain("chores-db:/var/lib/postgresql/data");
    expect(db).toContain("pg_isready");
  });

  it("builds the app and starts it once the database is healthy", () => {
    const app = service("app");
    expect(app).toContain("build: .");
    expect(app).toMatch(/depends_on:\s*\n\s*db:\s*\n\s*condition: service_healthy/);
    expect(app).toContain('"${APP_PORT:-3000}:3000"');
    expect(app).toContain("restart: unless-stopped");
  });

  it("points the app at the db service and sets the auth variables", () => {
    const app = service("app");
    expect(app).toContain(
      "DATABASE_URL: postgresql://chores:chores@db:5432/chores?schema=public",
    );
    expect(app).toContain(
      "DIRECT_URL: postgresql://chores:chores@db:5432/chores?schema=public",
    );
    expect(app).toMatch(/AUTH_SECRET: \$\{AUTH_SECRET:-[^}]*local-only[^}]*\}/);
    expect(app).toContain("AUTH_URL: http://localhost:${APP_PORT:-3000}");
    expect(app).toContain('AUTH_TRUST_HOST: "true"');
  });

  it("has a healthcheck on /signin", () => {
    const app = service("app");
    expect(app).toContain("healthcheck:");
    expect(app).toContain("http://127.0.0.1:3000/signin");
  });
});

describe("docker scripts", () => {
  it("start and stop the whole stack with one command", () => {
    expect(pkg.scripts["docker:up"]).toBe("docker compose up -d --build --wait");
    expect(pkg.scripts["docker:down"]).toBe("docker compose down");
  });

  it("leave dev:all and test:all on the db service alone", () => {
    expect(read("scripts/dev-all.mjs")).toContain('["compose", "up", "-d", "--wait", "db"]');
    expect(read("scripts/test-all.mjs")).toMatch(/"--wait",\s*"db"/);
  });
});

describe("container entrypoint", () => {
  const steps = buildSteps({
    root: "/app",
    nodePath: "/usr/local/bin/node",
    prismaCli: "/opt/prisma-cli/node_modules/prisma/build/index.js",
  });

  it("migrates, then seeds only an unseeded database", () => {
    expect(steps.map((step) => step.name)).toEqual([
      "Apply migrations",
      "Seed demo data (only if not seeded yet)",
    ]);
    const [migrate, seed] = steps;
    expect(migrate.command).toBe("/usr/local/bin/node");
    expect(migrate.args.slice(0, 3)).toEqual([
      "/opt/prisma-cli/node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
    ]);
    expect(migrate.args).not.toContain("reset");
    expect(seed.args.at(-1)).toBe("--skip-if-seeded");
    expect(seed.args[0]).toMatch(/prisma[\\/]seed\.ts$/);
  });

  it("reports the required variables that are missing", () => {
    expect(REQUIRED_ENV).toEqual(["DATABASE_URL", "DIRECT_URL", "AUTH_SECRET"]);
    expect(missingEnv({})).toEqual(REQUIRED_ENV);
    expect(missingEnv({ DATABASE_URL: "x", DIRECT_URL: "", AUTH_SECRET: "s" })).toEqual([
      "DIRECT_URL",
    ]);
  });
});
