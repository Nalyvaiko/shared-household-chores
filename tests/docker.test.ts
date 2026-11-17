import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

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

  it("sends instrumentation.ts to the build, so the image can export telemetry", () => {
    expect(read(".dockerignore")).toMatch(/^!instrumentation\.ts\s*$/m);
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

  it("leaves the app's telemetry off unless OTEL_EXPORTER_OTLP_ENDPOINT is set", () => {
    const app = service("app");
    expect(app).toContain("OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-}");
    // A profiled service cannot be a dependency of one that always runs.
    expect(app).not.toContain("observability");
  });

  it("runs the observability stack only under its profile, with stored data", () => {
    const obs = service("observability");
    expect(obs).toMatch(/image: grafana\/otel-lgtm:\d+\.\d+\.\d+/);
    expect(obs).toContain("profiles: [observability]");
    expect(obs).toContain('"${OBSERVABILITY_UI_PORT:-3001}:3000"');
    expect(obs).toContain('"${OTLP_HTTP_PORT:-4318}:4318"');
    expect(obs).toContain("observability-data:/data");
    expect(obs).toContain("./observability/grafana/dashboards:/otel-lgtm/chores-dashboards:ro");
    expect(compose).toMatch(/^ {2}observability-data:\s*$/m);
  });

  it("provisions a dashboard that queries the journey's metrics, traces and logs", () => {
    const dashboard = read("observability/grafana/dashboards/complete-a-chore.json");
    const parsed = JSON.parse(dashboard) as { panels: unknown[] };
    expect(parsed.panels.length).toBeGreaterThan(0);
    for (const needle of [
      "chores_completions_total",
      "chores_complete_duration_milliseconds_bucket",
      "chores_rollovers_total",
      'name=\\"chores.complete\\"',
      'service_name=\\"shared-household-chores\\"',
    ]) {
      expect(dashboard).toContain(needle);
    }
  });
});

type AlertQuery = {
  refId: string;
  datasourceUid: string;
  model: { expr?: string; type?: string; conditions?: { evaluator: { type: string; params: number[] } }[] };
};
type AlertRule = {
  uid: string;
  title: string;
  condition: string;
  data: AlertQuery[];
  for: string;
  noDataState: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
};

describe("alerting (Grafana, observability profile)", () => {
  const rulesFile = parseYaml(read("observability/grafana/alerting/alert-rules.yaml")) as {
    apiVersion: number;
    groups: { name: string; folder: string; interval: string; rules: AlertRule[] }[];
  };
  const notifications = parseYaml(read("observability/grafana/alerting/notifications.yaml")) as {
    contactPoints: { name: string; receivers: { type: string; settings: { url: string } }[] }[];
    policies: { receiver: string }[];
  };
  const [group] = rulesFile.groups;
  const rule = (title: string) => {
    const found = group.rules.find((candidate) => candidate.title === title);
    expect(found, title).toBeDefined();
    return found!;
  };
  const query = (r: AlertRule) => r.data.find((d) => d.refId === "A")!;
  const threshold = (r: AlertRule) => {
    const condition = r.data.find((d) => d.refId === r.condition)!;
    expect(condition.model.type).toBe("threshold");
    return condition.model.conditions![0].evaluator;
  };

  it("evaluates one group every minute in the project's folder", () => {
    expect(rulesFile.apiVersion).toBe(1);
    expect(rulesFile.groups).toHaveLength(1);
    expect(group.folder).toBe("Shared household chores");
    expect(group.interval).toBe("1m");
    expect(group.rules.map((r) => r.title)).toEqual([
      "Chore completions failing",
      "Chore completions slow",
    ]);
  });

  it("pages on any Complete that ended in a server error", () => {
    const failing = rule("Chore completions failing");
    const a = query(failing);
    expect(a.datasourceUid).toBe("prometheus");
    expect(a.model.expr).toContain('chores_completions_total{chore_outcome="error"}');
    expect(a.model.expr).toContain("[5m]");
    expect(threshold(failing)).toEqual({ type: "gt", params: [0] });
    expect(failing.for).toBe("1m");
    expect(failing.labels).toEqual({ severity: "critical", journey: "complete-chore" });
  });

  it("warns when p95 Complete time stays above 2 s", () => {
    const slow = rule("Chore completions slow");
    const a = query(slow);
    expect(a.datasourceUid).toBe("prometheus");
    expect(a.model.expr).toMatch(
      /histogram_quantile\(0\.95,[\s\S]*chores_complete_duration_milliseconds_bucket\[5m\]/,
    );
    expect(threshold(slow)).toEqual({ type: "gt", params: [2000] });
    expect(slow.for).toBe("5m");
    expect(slow.labels).toEqual({ severity: "warning", journey: "complete-chore" });
  });

  it("treats no traffic as OK and explains the user impact with a runbook", () => {
    for (const r of group.rules) {
      expect(r.noDataState, r.title).toBe("OK");
      expect(r.annotations.summary, r.title).toBeTruthy();
      expect(r.annotations.description, r.title).toMatch(/People pressing Complete/);
      expect(r.annotations.runbook_url, r.title).toMatch(/README\.md#alerts$/);
    }
    expect(read("README.md")).toMatch(/^#### Alerts$|^### Alerts$/m);
  });

  it("sends every alert to the webhook receiver", () => {
    const [contactPoint] = notifications.contactPoints;
    expect(contactPoint.receivers[0].type).toBe("webhook");
    expect(contactPoint.receivers[0].settings.url).toMatch(/^http:\/\/alert-receiver:8080\//);
    expect(notifications.policies[0].receiver).toBe(contactPoint.name);
  });

  it("mounts the files into Grafana and runs the receiver only under the profile", () => {
    const obs = service("observability");
    expect(obs).toContain(
      "./observability/grafana/alerting/alert-rules.yaml:/otel-lgtm/grafana/conf/provisioning/alerting/",
    );
    expect(obs).toContain(
      "./observability/grafana/alerting/notifications.yaml:/otel-lgtm/grafana/conf/provisioning/alerting/",
    );
    expect(obs).toContain("GF_SERVER_ROOT_URL: http://localhost:${OBSERVABILITY_UI_PORT:-3001}/");
    const receiver = service("alert-receiver");
    expect(receiver).toMatch(/image: mendhak\/http-https-echo:\d+/);
    expect(receiver).toContain("profiles: [observability]");
    expect(receiver).not.toContain("ports:");
  });
});

describe("docker scripts", () => {
  it("start and stop the whole stack with one command", () => {
    expect(pkg.scripts["docker:up"]).toBe("docker compose up -d --build --wait");
    expect(pkg.scripts["docker:down"]).toBe("docker compose down");
  });

  it("start and stop the observability stack on its own", () => {
    expect(pkg.scripts["observability:up"]).toBe(
      "docker compose --profile observability up -d --wait observability alert-receiver oncall-agent",
    );
    expect(pkg.scripts["observability:down"]).toBe(
      "docker compose --profile observability stop observability alert-receiver oncall-agent",
    );
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
