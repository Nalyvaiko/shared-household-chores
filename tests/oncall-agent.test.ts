import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  DEFAULT_TOKEN,
  buildReport,
  createAgentServer,
  createRateLimiter,
  isAuthorized,
  loadConfig,
  runIncident,
  triage,
} from "../oncall/agent.mjs";
import {
  ALLOWED_ACTIONS,
  PLAYBOOKS,
  decideCompletionsFailing,
  decideCompletionsSlow,
  findPlaybook,
  isAllowedAction,
} from "../oncall/playbooks.mjs";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

type Container = { exists: boolean; state?: string; health?: string };
const facts = (
  db: Container,
  app: Container = { exists: true, state: "running", health: "healthy" },
  extra: { dbReachable?: boolean; signinStatus?: number | null } = {},
) => ({
  containers: { db, app },
  dbReachable: extra.dbReachable ?? db.state === "running",
  signinStatus: extra.signinStatus ?? 200,
});
const healthyDb = { exists: true, state: "running", health: "healthy" };

const FAILING = { alertname: "Chore completions failing", journey: "complete-chore", severity: "critical" };
const SLOW = { alertname: "Chore completions slow", journey: "complete-chore", severity: "warning" };
const firing = (labels: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  status: "firing",
  labels,
  annotations: { summary: "free text that must not reach a report", description: "x" },
  startsAt: "2026-11-16T10:00:00Z",
  fingerprint: "a1b2c3d4e5f60718",
  ...extra,
});

describe("playbook: Chore completions failing", () => {
  it("starts the database container when it is not running", () => {
    for (const state of ["exited", "created", "dead"]) {
      const decision = decideCompletionsFailing(facts({ exists: true, state, health: "unhealthy" }));
      expect(decision).toMatchObject({ kind: "act", needsHuman: false });
      expect(decision.actions).toEqual([{ type: "start", service: "db" }]);
      expect(decision.reason).toBe(`database container is ${state}`);
    }
  });

  it("restarts a running but unhealthy database", () => {
    const decision = decideCompletionsFailing(
      facts({ exists: true, state: "running", health: "unhealthy" }),
    );
    expect(decision.actions).toEqual([{ type: "restart", service: "db" }]);
  });

  it("starts or restarts the app only while the database is healthy", () => {
    expect(
      decideCompletionsFailing(facts(healthyDb, { exists: true, state: "exited" })).actions,
    ).toEqual([{ type: "start", service: "app" }]);
    expect(
      decideCompletionsFailing(
        facts(healthyDb, { exists: true, state: "running", health: "unhealthy" }),
      ).actions,
    ).toEqual([{ type: "restart", service: "app" }]);
  });

  it("escalates with no action when nothing on the allow-list fits", () => {
    const cases = [
      facts({ exists: false }),
      facts({ exists: true, state: "running", health: "starting" }),
      facts(healthyDb, undefined, { dbReachable: false }),
      facts(healthyDb), // everything healthy: a code or migration problem
      facts(healthyDb, { exists: false }), // app runs outside Docker (npm run dev)
    ];
    for (const input of cases) {
      const decision = decideCompletionsFailing(input);
      expect(decision).toMatchObject({ kind: "escalate", actions: [], needsHuman: true });
    }
    expect(decideCompletionsFailing(facts(healthyDb)).reason).toMatch(/needs a human/);
  });

  it("only ever proposes allow-listed actions", () => {
    const states = ["running", "exited", "created", "dead", "paused", "restarting", undefined];
    const healths = ["healthy", "unhealthy", "starting", "none", undefined];
    for (const dbState of states)
      for (const dbHealth of healths)
        for (const appState of states)
          for (const appHealth of healths) {
            const decision = decideCompletionsFailing(
              facts(
                { exists: true, state: dbState, health: dbHealth },
                { exists: true, state: appState, health: appHealth },
              ),
            );
            for (const action of decision.actions) expect(isAllowedAction(action)).toBe(true);
          }
  });
});

describe("playbook: Chore completions slow", () => {
  it("diagnoses only and escalates", () => {
    expect(decideCompletionsSlow()).toMatchObject({ kind: "escalate", actions: [], needsHuman: true });
  });
});

describe("allow-list and matching", () => {
  it("allows only start/restart of db and app", () => {
    expect(Object.keys(ALLOWED_ACTIONS).sort()).toEqual(["restart", "start"]);
    expect(isAllowedAction({ type: "start", service: "db" })).toBe(true);
    expect(isAllowedAction({ type: "restart", service: "app" })).toBe(true);
    for (const bad of [
      { type: "remove", service: "db" },
      { type: "stop", service: "db" },
      { type: "start", service: "observability" },
      { type: "restart", service: "oncall-agent" },
      { type: "__proto__", service: "db" },
      null,
    ]) {
      expect(isAllowedAction(bad)).toBe(false);
    }
  });

  it("matches playbooks to the provisioned rules by alertname and journey", () => {
    expect(findPlaybook(FAILING)?.id).toBe("completions-failing");
    expect(findPlaybook(SLOW)?.id).toBe("completions-slow");
    expect(findPlaybook({ alertname: "Chore completions failing" })).toBeUndefined();
    expect(findPlaybook({ alertname: "Something else", journey: "complete-chore" })).toBeUndefined();

    const rules = parseYaml(read("observability/grafana/alerting/alert-rules.yaml")) as {
      groups: { rules: { uid: string; title: string; labels: Record<string, string> }[] }[];
    };
    for (const playbook of PLAYBOOKS) {
      const rule = rules.groups[0].rules.find((r) => r.uid === playbook.ruleUid);
      expect(rule, playbook.id).toBeDefined();
      expect(findPlaybook({ alertname: rule!.title, ...rule!.labels })).toBe(playbook);
    }
  });

  it("handles firing alerts with a playbook and ignores the rest", () => {
    const { handled, ignored } = triage({
      status: "firing",
      alerts: [
        firing(FAILING),
        { ...firing(FAILING), status: "resolved" },
        firing({ alertname: "Disk full" }),
      ],
    });
    expect(handled.map((h: { playbook: { id: string } }) => h.playbook.id)).toEqual([
      "completions-failing",
    ]);
    expect(ignored).toEqual([
      { alertname: "Chore completions failing", reason: "not firing" },
      { alertname: "Disk full", reason: "no playbook" },
    ]);
    expect(triage(null)).toEqual({ handled: [], ignored: [] });
  });
});

describe("token check", () => {
  it("accepts only the configured bearer token", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorized("bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(isAuthorized("s3cret", "s3cret")).toBe(false);
    expect(isAuthorized("Basic s3cret", "s3cret")).toBe(false);
    expect(isAuthorized(undefined, "s3cret")).toBe(false);
    expect(isAuthorized("Bearer ", "")).toBe(false);
  });

  it("defaults to the local token and reads the dry-run flag", () => {
    expect(loadConfig({}).token).toBe(DEFAULT_TOKEN);
    expect(loadConfig({}).dryRun).toBe(false);
    expect(loadConfig({ ONCALL_DRY_RUN: "1" }).dryRun).toBe(true);
    expect(loadConfig({}).maxActions).toBe(2);
  });
});

describe("rate limit", () => {
  it("allows N actions per key per 10 minutes", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, now: () => now });
    expect(limiter.tryTake("a")).toBe(true);
    expect(limiter.tryTake("a")).toBe(true);
    expect(limiter.tryTake("a")).toBe(false);
    expect(limiter.tryTake("b")).toBe(true);
    now = 10 * 60 * 1000 - 1;
    expect(limiter.tryTake("a")).toBe(false);
    now = 10 * 60 * 1000;
    expect(limiter.remaining("a")).toBe(2);
    expect(limiter.tryTake("a")).toBe(true);
  });
});

/** Fake I/O for runIncident: a db container that is exited until started. */
function fakeDeps(overrides: Record<string, unknown> = {}) {
  let now = Date.parse("2026-11-16T10:00:00Z");
  const db = { exists: true, id: "dbid", state: "exited", health: "unhealthy" };
  const docker = {
    start: vi.fn(async () => {
      db.state = "running";
      db.health = "healthy";
      return true;
    }),
    restart: vi.fn(async () => true),
  };
  const config = { ...loadConfig({}), pollIntervalMs: 1000, verifyTimeoutMs: 60_000, ...overrides };
  return {
    db,
    docker,
    deps: {
      config,
      docker,
      project: async () => "oncall-check",
      containers: async () => ({
        db: { ...db },
        app: { exists: true, id: "appid", state: "running", health: "healthy" },
        "other-service": { exists: true, id: "x", state: "running", health: "none" },
      }),
      tcp: async () => db.state === "running",
      signin: async () => 200,
      failedCompletions: async () => ({
        count: 3,
        traceIds: ["0123456789abcdef0123456789abcdef", "not-a-trace-id", "jane@example.com"],
      }),
      ruleState: async () => "inactive",
      clock: () => now,
      pause: async (ms: number) => {
        now += ms;
      },
    },
  };
}

const playbook = PLAYBOOKS[0];

describe("incident run", () => {
  it("starts the stopped database, verifies and reports remediated", async () => {
    const { deps, docker } = fakeDeps();
    const limiter = createRateLimiter({ max: 2 });
    const report = await runIncident({ alert: firing(FAILING), playbook, deps, limiter });
    expect(docker.start).toHaveBeenCalledWith("dbid");
    expect(docker.restart).not.toHaveBeenCalled();
    expect(report.outcome).toBe("remediated");
    expect(report.needsHuman).toBe(false);
    expect(report.actions).toEqual([
      expect.objectContaining({ type: "start", service: "db", executed: true, result: "ok" }),
    ]);
    expect(report.verification).toEqual({
      status: "resolved",
      dbHealthy: true,
      signinOk: true,
      alertNormal: true,
    });
    expect(report.timeline.map((t: { step: string }) => t.step)).toEqual([
      "woke",
      "diagnosed",
      "action:start:db",
      "db-healthy",
      "signin-ok",
      "alert-normal",
    ]);
  });

  it("in dry-run mode only reports what it would do", async () => {
    const { deps, docker, db } = fakeDeps({ dryRun: true });
    const report = await runIncident({
      alert: firing(FAILING),
      playbook,
      deps,
      limiter: createRateLimiter({ max: 2 }),
    });
    expect(docker.start).not.toHaveBeenCalled();
    expect(docker.restart).not.toHaveBeenCalled();
    expect(db.state).toBe("exited");
    expect(report).toMatchObject({ dryRun: true, outcome: "dry-run", needsHuman: true });
    expect(report.actions).toEqual([
      expect.objectContaining({ type: "start", service: "db", executed: false, result: "dry run: not executed" }),
    ]);
    expect(report.verification).toEqual({ status: "skipped", reason: "dry run" });
  });

  it("refuses to act past the rate limit and escalates", async () => {
    const { deps, docker } = fakeDeps();
    const limiter = createRateLimiter({ max: 0 });
    const report = await runIncident({ alert: firing(FAILING), playbook, deps, limiter });
    expect(docker.start).not.toHaveBeenCalled();
    expect(report).toMatchObject({ outcome: "rate-limited", needsHuman: true });
  });

  it("reports unresolved when the alert does not return to Normal in time", async () => {
    const { deps } = fakeDeps({ verifyTimeoutMs: 5000 });
    deps.ruleState = async () => "firing";
    const report = await runIncident({
      alert: firing(FAILING),
      playbook,
      deps,
      limiter: createRateLimiter({ max: 2 }),
    });
    expect(report.verification).toMatchObject({ status: "unresolved", alertNormal: false });
    expect(report).toMatchObject({ outcome: "escalated", needsHuman: true });
  });

  it("never acts when its own compose project is unknown", async () => {
    const { deps, docker } = fakeDeps();
    deps.project = async () => "";
    const report = await runIncident({
      alert: firing(FAILING),
      playbook,
      deps,
      limiter: createRateLimiter({ max: 2 }),
    });
    expect(docker.start).not.toHaveBeenCalled();
    expect(report.outcome).toBe("escalated");
  });
});

describe("incident report", () => {
  it("has a fixed shape with ids, counts and states only", async () => {
    const { deps } = fakeDeps();
    const report = await runIncident({
      alert: firing(FAILING, { valueString: "[ var='A' value=3 ]", generatorURL: "http://x/?q=1" }),
      playbook,
      deps,
      limiter: createRateLimiter({ max: 2 }),
    });
    expect(Object.keys(report).sort()).toEqual(
      [
        "actions",
        "alert",
        "decision",
        "diagnosis",
        "dryRun",
        "endedAt",
        "incidentId",
        "needsHuman",
        "outcome",
        "playbook",
        "startedAt",
        "timeline",
        "traceIds",
        "type",
        "verification",
      ].sort(),
    );
    expect(report.type).toBe("oncall.incident");
    expect(report.incidentId).toMatch(/^inc-[0-9a-z]+-[0-9a-f]{6}$/);
    expect(report.alert).toEqual({
      name: "Chore completions failing",
      ruleUid: "chores-complete-failing",
      severity: "critical",
      journey: "complete-chore",
      startsAt: "2026-11-16T10:00:00Z",
      fingerprint: "a1b2c3d4e5f60718",
    });
    expect(report.diagnosis.failedCompletions).toEqual({
      count: 3,
      traceIds: ["0123456789abcdef0123456789abcdef"],
    });
    expect(report.traceIds).toEqual(["0123456789abcdef0123456789abcdef"]);
    expect(report.diagnosis.containers.db).toEqual({ exists: true, state: "exited", health: "unhealthy" });
    // Container ids are not needed in the report.
    expect(JSON.stringify(report)).not.toContain("dbid");

    const text = JSON.stringify(report);
    for (const forbidden of ["free text", "annotations", "@", "valueString", "generatorURL", "?q="]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("drops unchecked values even when given them", () => {
    const report = buildReport({
      incidentId: "inc-1",
      playbook: "completions-failing",
      alert: {},
      diagnosis: {
        composeProject: "postgresql://user:pw@host/db",
        containers: { "db": { exists: true, state: "running <script>", health: "healthy" } },
        dbReachable: true,
        signinStatus: "200",
        failedCompletions: { count: "lots", traceIds: ["jane@example.com"] },
      },
    });
    expect(report.diagnosis.composeProject).toBeUndefined();
    expect(report.diagnosis.containers.db.state).toBeUndefined();
    expect(report.diagnosis.signinStatus).toBeNull();
    expect(report.diagnosis.failedCompletions).toEqual({ count: null, traceIds: [] });
  });
});

describe("webhook server", () => {
  let server: ReturnType<typeof createAgentServer> | undefined;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  async function start(handle = vi.fn(async () => {})) {
    server = createAgentServer({
      config: { ...loadConfig({}), token: "t0ken" },
      deps: {} as never,
      limiter: createRateLimiter({ max: 2 }),
      handle,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const post = (body: unknown, auth?: string) =>
      fetch(`http://127.0.0.1:${port}/alerts`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
        body: JSON.stringify(body),
      });
    return { post, port, handle };
  }

  it("rejects a missing or wrong token with 401 and does nothing", async () => {
    const { post, handle } = await start();
    const body = { alerts: [firing(FAILING)] };
    expect((await post(body)).status).toBe(401);
    expect((await post(body, "Bearer nope")).status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("accepts a firing alert with a playbook (202) and ignores others (204)", async () => {
    const { post, handle } = await start();
    expect((await post({ alerts: [firing(FAILING)] }, "Bearer t0ken")).status).toBe(202);
    expect(handle).toHaveBeenCalledTimes(1);
    expect((await post({ alerts: [{ ...firing(FAILING), status: "resolved" }] }, "Bearer t0ken")).status).toBe(204);
    expect((await post({ alerts: [firing({ alertname: "Disk full" })] }, "Bearer t0ken")).status).toBe(204);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("answers the healthcheck", async () => {
    const { port } = await start();
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  });
});

describe("wiring (docker-compose.yml, Grafana contact point)", () => {
  const compose = parseYaml(read("docker-compose.yml")) as {
    services: Record<
      string,
      {
        image?: string;
        build?: unknown;
        profiles?: string[];
        ports?: unknown;
        command?: string[];
        environment?: Record<string, string>;
        volumes?: string[];
      }
    >;
    volumes: Record<string, unknown>;
  };
  const agent = compose.services["oncall-agent"];

  it("runs the agent from the stock Node image under the observability profile only", () => {
    expect(agent.image).toBe("node:24-slim");
    expect(agent.build).toBeUndefined();
    expect(agent.profiles).toEqual(["observability"]);
    expect(agent.ports).toBeUndefined();
    expect(agent.command).toEqual(["node", "/oncall/agent.mjs"]);
    expect(agent.volumes).toEqual(
      expect.arrayContaining([
        "./oncall:/oncall:ro",
        "oncall-incidents:/var/lib/oncall",
        "/var/run/docker.sock:/var/run/docker.sock:ro",
      ]),
    );
    expect(compose.volumes).toHaveProperty("oncall-incidents");
    expect(agent.environment?.ONCALL_DRY_RUN).toBe("${ONCALL_DRY_RUN:-0}");
    // The db and app services stay free of the profile, so plain `up`,
    // dev:all and test:all are unchanged.
    expect(compose.services.db.profiles).toBeUndefined();
    expect(compose.services.app.profiles).toBeUndefined();
  });

  it("shares one token default between Grafana and the agent", () => {
    const tokenEnv = `\${ONCALL_AGENT_TOKEN:-${DEFAULT_TOKEN}}`;
    expect(agent.environment?.ONCALL_AGENT_TOKEN).toBe(tokenEnv);
    expect(compose.services.observability.environment?.ONCALL_AGENT_TOKEN).toBe(tokenEnv);
  });

  it("adds the agent to the contact point every alert is routed to", () => {
    const notifications = parseYaml(read("observability/grafana/alerting/notifications.yaml")) as {
      contactPoints: {
        name: string;
        receivers: { uid: string; type: string; settings: Record<string, string>; disableResolveMessage?: boolean }[];
      }[];
      policies: { receiver: string }[];
    };
    const [contactPoint] = notifications.contactPoints;
    expect(notifications.policies[0].receiver).toBe(contactPoint.name);
    const integration = contactPoint.receivers.find((r) => r.uid === "chores-oncall-agent");
    expect(integration).toMatchObject({
      type: "webhook",
      settings: {
        url: "http://oncall-agent:8080/alerts",
        httpMethod: "POST",
        authorization_scheme: "Bearer",
        authorization_credentials: "$ONCALL_AGENT_TOKEN",
      },
    });
  });
});
