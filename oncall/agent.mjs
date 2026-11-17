/**
 * On-call agent: wakes up on a Grafana alert webhook, diagnoses the local
 * Compose stack, applies an allow-listed fix, verifies it and writes an
 * incident report. Rule-based and deterministic: the decisions are the
 * playbooks in ./playbooks.mjs. Plain Node 24, no dependencies.
 *
 * Runs as the `oncall-agent` service of the `observability` Compose profile
 * (docker-compose.yml), with this folder bind-mounted. README "On-call agent".
 *
 *   POST /alerts   Grafana webhook (Authorization: Bearer $ONCALL_AGENT_TOKEN)
 *   GET  /healthz  liveness, for the Compose healthcheck
 *
 * Guardrails: only `start` / `restart` of the `db` and `app` containers of its
 * own Compose project; never removes anything and never touches volumes; at
 * most ONCALL_MAX_ACTIONS actions per alert per 10 minutes; ONCALL_DRY_RUN=1
 * only reports. Reports hold ids, counts and states only, no customer data.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import http from "node:http";
import net from "node:net";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { PLAYBOOKS, findPlaybook, isAllowedAction } from "./playbooks.mjs";

export const SERVICE = "oncall-agent";
export const DEFAULT_TOKEN = "local-oncall-agent-token";
export const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Settings from the environment, with the defaults the Compose service uses.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const int = (value, fallback) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    port: int(env.ONCALL_PORT, 8080),
    token: env.ONCALL_AGENT_TOKEN || DEFAULT_TOKEN,
    dryRun: ["1", "true", "yes"].includes(String(env.ONCALL_DRY_RUN ?? "").toLowerCase()),
    maxActions: int(env.ONCALL_MAX_ACTIONS, 2),
    dockerSocket: env.ONCALL_DOCKER_SOCKET || "/var/run/docker.sock",
    composeProject: env.ONCALL_COMPOSE_PROJECT || "",
    dbHost: env.ONCALL_DB_HOST || "db",
    dbPort: int(env.ONCALL_DB_PORT, 5432),
    appUrl: (env.ONCALL_APP_URL || "http://app:3000").replace(/\/$/, ""),
    grafanaUrl: (env.ONCALL_GRAFANA_URL || "http://observability:3000").replace(/\/$/, ""),
    lokiDatasourceUid: env.ONCALL_LOKI_DATASOURCE_UID || "loki",
    reportFile: env.ONCALL_REPORT_FILE || "/var/lib/oncall/incidents.jsonl",
    reportWebhook: env.ONCALL_REPORT_WEBHOOK ?? "",
    otlpEndpoint: (env.ONCALL_OTLP_ENDPOINT ?? "").replace(/\/$/, ""),
    healthTimeoutMs: int(env.ONCALL_HEALTH_TIMEOUT_MS, 120_000),
    verifyTimeoutMs: int(env.ONCALL_VERIFY_TIMEOUT_MS, 15 * 60 * 1000),
    pollIntervalMs: int(env.ONCALL_POLL_INTERVAL_MS, 15_000),
  };
}

/** One JSON line on stdout; `docker compose logs oncall-agent` shows it. */
export function log(event, fields = {}, write = (line) => process.stdout.write(`${line}\n`)) {
  write(JSON.stringify({ time: new Date().toISOString(), service: SERVICE, event, ...fields }));
}

// --- Authentication ---------------------------------------------------------

const digest = (value) => createHash("sha256").update(String(value)).digest();

/** True for `Bearer <token>` with the expected token (constant-time compare). */
export function isAuthorized(header, token) {
  if (typeof header !== "string" || !token) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(token));
}

// --- Rate limit -------------------------------------------------------------

/** At most `max` actions per key in any `windowMs` window. */
export function createRateLimiter({ max, windowMs = RATE_WINDOW_MS, now = Date.now }) {
  const taken = new Map();
  const recent = (key) => (taken.get(key) ?? []).filter((at) => now() - at < windowMs);
  return {
    remaining(key) {
      return Math.max(0, max - recent(key).length);
    },
    tryTake(key) {
      const kept = recent(key);
      if (kept.length >= max) {
        taken.set(key, kept);
        return false;
      }
      kept.push(now());
      taken.set(key, kept);
      return true;
    },
  };
}

// --- Webhook payload --------------------------------------------------------

/**
 * Splits a Grafana webhook body into the firing alerts a playbook handles and
 * the rest (resolved, or no playbook), which are only logged.
 */
export function triage(payload, playbooks = PLAYBOOKS) {
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  const handled = [];
  const ignored = [];
  for (const alert of alerts) {
    const name = typeof alert?.labels?.alertname === "string" ? alert.labels.alertname : "";
    if (alert?.status !== "firing") {
      ignored.push({ alertname: safeName(name), reason: "not firing" });
      continue;
    }
    const playbook = findPlaybook(alert.labels, playbooks);
    if (!playbook) {
      ignored.push({ alertname: safeName(name), reason: "no playbook" });
      continue;
    }
    handled.push({ alert, playbook });
  }
  return { handled, ignored };
}

// --- Report (privacy: ids, counts and states only) ---------------------------

const IDENT = /^[A-Za-z0-9_.\- ]{1,64}$/;
const HEX = /^[0-9a-f]+$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const safeName = (value) => (typeof value === "string" && IDENT.test(value) ? value : "unknown");
const safeOpt = (value, pattern) =>
  typeof value === "string" && pattern.test(value) ? value : undefined;

/** Valid, de-duplicated trace ids, at most `limit`. */
export function cleanTraceIds(ids, limit = 20) {
  return [...new Set((ids ?? []).filter((id) => typeof id === "string" && TRACE_ID.test(id)))].slice(
    0,
    limit,
  );
}

/** The fields of a Grafana alert that may go into a report. Annotations never do. */
export function alertSummary(alert, playbook) {
  const labels = alert?.labels ?? {};
  return {
    name: safeName(labels.alertname),
    ruleUid: playbook?.ruleUid,
    severity: ["critical", "warning", "info"].includes(labels.severity) ? labels.severity : undefined,
    journey: safeOpt(labels.journey, IDENT),
    startsAt: safeOpt(alert?.startsAt, ISO_TIME),
    fingerprint: safeOpt(alert?.fingerprint, HEX),
  };
}

/** The structured incident record. Only these keys, with checked values. */
export function buildReport(incident) {
  const containers = {};
  for (const [service, c] of Object.entries(incident.diagnosis?.containers ?? {})) {
    if (!IDENT.test(service)) continue;
    containers[service] = {
      exists: Boolean(c.exists),
      state: safeOpt(c.state, IDENT),
      health: safeOpt(c.health, IDENT),
    };
  }
  const failed = incident.diagnosis?.failedCompletions;
  const traceIds = cleanTraceIds(failed?.traceIds);
  return {
    type: "oncall.incident",
    incidentId: incident.incidentId,
    playbook: incident.playbook,
    dryRun: Boolean(incident.dryRun),
    alert: incident.alert,
    startedAt: incident.startedAt,
    endedAt: incident.endedAt,
    outcome: incident.outcome,
    needsHuman: Boolean(incident.needsHuman),
    diagnosis: incident.diagnosis && {
      composeProject: safeOpt(incident.diagnosis.composeProject, IDENT),
      containers,
      dbReachable: incident.diagnosis.dbReachable,
      signinStatus: Number.isInteger(incident.diagnosis.signinStatus)
        ? incident.diagnosis.signinStatus
        : null,
      failedCompletions: failed && {
        count: Number.isInteger(failed.count) ? failed.count : null,
        traceIds,
      },
    },
    decision: incident.decision && {
      kind: incident.decision.kind,
      reason: incident.decision.reason,
    },
    actions: (incident.actions ?? []).map((a) => ({
      type: a.type,
      service: a.service,
      at: a.at,
      executed: Boolean(a.executed),
      result: a.result,
    })),
    verification: incident.verification,
    timeline: incident.timeline ?? [],
    traceIds,
  };
}

// --- Docker Engine API (unix socket) ----------------------------------------

/** A tiny Docker Engine API client over the socket. */
export function createDocker(socketPath) {
  const request = (method, path, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { socketPath, method, path, headers: { "content-type": "application/json" } },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json;
            try {
              json = text ? JSON.parse(text) : undefined;
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      req.setTimeout(30_000, () => req.destroy(new Error("docker api timeout")));
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });

  return {
    async inspect(id) {
      const res = await request("GET", `/containers/${encodeURIComponent(id)}/json`);
      return res.status === 200 ? res.json : undefined;
    },
    async listProject(project) {
      const filters = encodeURIComponent(
        JSON.stringify({ label: [`com.docker.compose.project=${project}`] }),
      );
      const res = await request("GET", `/containers/json?all=true&filters=${filters}`);
      return res.status === 200 && Array.isArray(res.json) ? res.json : [];
    },
    // The only two write calls the agent has. No remove, no volume calls.
    async start(id) {
      const res = await request("POST", `/containers/${encodeURIComponent(id)}/start`);
      return res.status === 204 || res.status === 304;
    },
    async restart(id) {
      const res = await request("POST", `/containers/${encodeURIComponent(id)}/restart?t=10`);
      return res.status === 204;
    },
  };
}

const PROJECT_LABEL = "com.docker.compose.project";
const SERVICE_LABEL = "com.docker.compose.service";

/** The agent's own Compose project: the env override, else its container's label. */
export async function resolveProject(docker, config, self = hostname()) {
  if (config.composeProject) return config.composeProject;
  const me = await docker.inspect(self).catch(() => undefined);
  const project = me?.Config?.Labels?.[PROJECT_LABEL];
  return typeof project === "string" && IDENT.test(project) ? project : "";
}

/** Containers of this project by Compose service, with state and health. */
export async function projectContainers(docker, project) {
  const byService = {};
  if (!project) return byService;
  for (const summary of await docker.listProject(project)) {
    const labels = summary.Labels ?? {};
    if (labels[PROJECT_LABEL] !== project) continue; // belt and braces
    const service = labels[SERVICE_LABEL];
    if (typeof service !== "string" || !IDENT.test(service)) continue;
    const details = await docker.inspect(summary.Id).catch(() => undefined);
    byService[service] = {
      exists: true,
      id: summary.Id,
      state: details?.State?.Status ?? summary.State,
      health: details?.State?.Health?.Status ?? "none",
    };
  }
  return byService;
}

// --- Probes -----------------------------------------------------------------

/** True when a TCP connection to host:port opens within the timeout. */
export function tcpCheck(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** HTTP status of a GET, or null when unreachable. */
export async function httpStatus(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  } catch {
    return null;
  }
}

/**
 * Recent `chore.complete.failed` log lines in Loki (through Grafana's
 * datasource proxy): their count and trace ids. Message bodies are not read.
 */
export async function failedCompletions(config, now = Date.now(), minutes = 15) {
  const query = '{service_name="shared-household-chores"} | event_name="chore.complete.failed"';
  const params = new URLSearchParams({
    query,
    start: String((now - minutes * 60_000) * 1e6),
    end: String(now * 1e6),
    limit: "200",
    direction: "backward",
  });
  const url = `${config.grafanaUrl}/api/datasources/proxy/uid/${encodeURIComponent(config.lokiDatasourceUid)}/loki/api/v1/query_range?${params}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { count: null, traceIds: [] };
    const body = await res.json();
    let count = 0;
    const traceIds = [];
    for (const stream of body?.data?.result ?? []) {
      const values = Array.isArray(stream.values) ? stream.values : [];
      count += values.length;
      if (stream.stream?.trace_id) traceIds.push(stream.stream.trace_id);
      for (const value of values) {
        // With categorized labels, structured metadata rides in value[2].
        const meta = value?.[2]?.structuredMetadata;
        if (meta?.trace_id) traceIds.push(meta.trace_id);
      }
    }
    return { count, traceIds: cleanTraceIds(traceIds) };
  } catch {
    return { count: null, traceIds: [] };
  }
}

/** The Grafana rule's state (`firing`, `pending`, `inactive`/`normal`...) or null. */
export async function ruleState(config, ruleUid) {
  try {
    const res = await fetch(`${config.grafanaUrl}/api/prometheus/grafana/api/v1/rules`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    for (const group of body?.data?.groups ?? []) {
      for (const rule of group.rules ?? []) {
        if (rule.uid === ruleUid) return typeof rule.state === "string" ? rule.state : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const isNormalState = (state) => state === "inactive" || state === "normal";

// --- Incident ---------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it returns true or the timeout passes. */
async function waitFor(check, { timeoutMs, intervalMs, clock, pause }) {
  const deadline = clock() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (clock() >= deadline) return false;
    await pause(intervalMs);
  }
}

/** The real I/O behind an incident; tests pass fakes. */
export function createDeps(config) {
  const docker = createDocker(config.dockerSocket);
  return {
    config,
    docker,
    project: () => resolveProject(docker, config),
    containers: (project) => projectContainers(docker, project),
    tcp: () => tcpCheck(config.dbHost, config.dbPort),
    signin: () => httpStatus(`${config.appUrl}/signin`),
    failedCompletions: () => failedCompletions(config),
    ruleState: (uid) => ruleState(config, uid),
    clock: Date.now,
    pause: sleep,
  };
}

/**
 * One incident, end to end: diagnose → decide → act (guarded) → verify.
 * Returns the report (see buildReport); the caller publishes it.
 */
export async function runIncident({ alert, playbook, deps, limiter }) {
  const { config, clock } = deps;
  const iso = () => new Date(clock()).toISOString();
  const timeline = [];
  const mark = (step) => {
    const at = iso();
    timeline.push({ at, step });
    log("oncall.step", { step, at });
    return at;
  };
  const incident = {
    incidentId: `inc-${clock().toString(36)}-${randomBytes(3).toString("hex")}`,
    playbook: playbook.id,
    dryRun: config.dryRun,
    alert: alertSummary(alert, playbook),
    startedAt: mark("woke"),
    actions: [],
    timeline,
  };

  // Diagnose.
  const composeProject = await deps.project();
  const found = await deps.containers(composeProject);
  const [dbReachable, signinStatus, failed] = await Promise.all([
    deps.tcp(),
    deps.signin(),
    deps.failedCompletions(),
  ]);
  const containers = {};
  for (const [service, c] of Object.entries(found)) {
    containers[service] = { exists: true, state: c.state, health: c.health };
  }
  for (const service of ["db", "app"]) containers[service] ??= { exists: false };
  incident.diagnosis = { composeProject, containers, dbReachable, signinStatus, failedCompletions: failed };
  mark("diagnosed");

  // Decide.
  const decision = playbook.decide({ containers, dbReachable, signinStatus, failedCompletions: failed });
  incident.decision = decision;
  incident.needsHuman = decision.needsHuman;

  if (decision.kind !== "act") {
    incident.outcome = "escalated";
    incident.verification = { status: "skipped", reason: "no action taken" };
    return finish(incident, iso);
  }
  if (!composeProject) {
    incident.outcome = "escalated";
    incident.needsHuman = true;
    incident.decision = { kind: "escalate", reason: "own compose project unknown; refusing to act" };
    incident.verification = { status: "skipped", reason: "no action taken" };
    return finish(incident, iso);
  }

  // Act, within the guardrails.
  const rateKey = incident.alert.name;
  for (const action of decision.actions) {
    const record = { type: action.type, service: action.service, at: iso(), executed: false };
    incident.actions.push(record);
    const target = found[action.service];
    if (!isAllowedAction(action)) {
      record.result = "refused: not on the allow-list";
    } else if (!target?.id) {
      record.result = "refused: container not in this compose project";
    } else if (config.dryRun) {
      record.result = "dry run: not executed";
    } else if (!limiter.tryTake(rateKey)) {
      record.result = "refused: rate limit reached";
    } else {
      const ok = await (action.type === "start"
        ? deps.docker.start(target.id)
        : deps.docker.restart(target.id)
      ).catch(() => false);
      record.executed = ok;
      record.result = ok ? "ok" : "failed";
      mark(`action:${action.type}:${action.service}`);
    }
  }

  const executed = incident.actions.some((a) => a.executed);
  if (!executed) {
    incident.needsHuman = true;
    incident.outcome = config.dryRun
      ? "dry-run"
      : incident.actions.some((a) => a.result === "refused: rate limit reached")
        ? "rate-limited"
        : "escalated";
    incident.verification = {
      status: "skipped",
      reason: config.dryRun ? "dry run" : "no action executed",
    };
    return finish(incident, iso);
  }

  // Verify: the database is healthy, the sign-in page answers, the alert is Normal.
  const poll = { clock, pause: deps.pause, intervalMs: Math.min(config.pollIntervalMs, 2000) };
  const dbHealthy = await waitFor(
    async () => {
      const db = (await deps.containers(composeProject)).db;
      return db?.state === "running" && (db.health === "healthy" || db.health === "none");
    },
    { ...poll, timeoutMs: config.healthTimeoutMs },
  );
  if (dbHealthy) mark("db-healthy");
  const signinOk = await waitFor(async () => (await deps.signin()) === 200, {
    ...poll,
    timeoutMs: config.healthTimeoutMs,
  });
  if (signinOk) mark("signin-ok");
  let alertNormal = false;
  if (dbHealthy && signinOk) {
    alertNormal = await waitFor(async () => isNormalState(await deps.ruleState(playbook.ruleUid)), {
      clock,
      pause: deps.pause,
      intervalMs: config.pollIntervalMs,
      timeoutMs: config.verifyTimeoutMs,
    });
    if (alertNormal) mark("alert-normal");
  }
  const resolved = dbHealthy && signinOk && alertNormal;
  incident.verification = {
    status: resolved ? "resolved" : "unresolved",
    dbHealthy,
    signinOk,
    alertNormal,
  };
  incident.outcome = resolved ? "remediated" : "escalated";
  incident.needsHuman = !resolved;
  return finish(incident, iso);
}

function finish(incident, iso) {
  incident.endedAt = iso();
  return buildReport(incident);
}

// --- Publishing the report ----------------------------------------------------

/** stdout (JSON line), the incidents file, and optionally a webhook and OTLP logs. */
export async function publishReport(report, config) {
  log("oncall.incident", { report });
  try {
    await mkdir(dirname(config.reportFile), { recursive: true });
    await appendFile(config.reportFile, `${JSON.stringify(report)}\n`);
  } catch (error) {
    log("oncall.report_file_failed", { error: error?.code ?? "unknown" });
  }
  const post = async (url, body) => {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best effort: the file and stdout already hold the report.
    }
  };
  if (config.reportWebhook) await post(config.reportWebhook, report);
  if (config.otlpEndpoint) await post(`${config.otlpEndpoint}/v1/logs`, otlpLog(report));
}

/** The report as one OTLP/JSON log record (service.name = oncall-agent). */
export function otlpLog(report) {
  const str = (key, value) => ({ key, value: { stringValue: String(value) } });
  return {
    resourceLogs: [
      {
        resource: { attributes: [str("service.name", SERVICE)] },
        scopeLogs: [
          {
            scope: { name: SERVICE },
            logRecords: [
              {
                timeUnixNano: String(Date.parse(report.endedAt) * 1e6),
                severityNumber: report.needsHuman ? 13 : 9,
                severityText: report.needsHuman ? "WARN" : "INFO",
                body: { stringValue: JSON.stringify(report) },
                attributes: [
                  str("event.name", "oncall.incident"),
                  str("incident.id", report.incidentId),
                  str("incident.outcome", report.outcome),
                  str("incident.playbook", report.playbook),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// --- HTTP server ----------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * The webhook server. `handle` runs one incident (default: runIncident +
 * publishReport); one incident per alert name at a time.
 */
export function createAgentServer({ config, deps, limiter, handle } = {}) {
  config ??= loadConfig();
  deps ??= createDeps(config);
  limiter ??= createRateLimiter({ max: config.maxActions });
  handle ??= async (job) => publishReport(await runIncident({ ...job, deps, limiter }), config);
  const inFlight = new Set();

  return createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, body ? { "content-type": "application/json" } : {});
      res.end(body ? JSON.stringify(body) : undefined);
    };
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/healthz") return reply(200, { ok: true });
    if (path !== "/alerts") return reply(404);
    if (req.method !== "POST") return reply(405);
    if (!isAuthorized(req.headers.authorization, config.token)) {
      log("oncall.unauthorized", { remote: req.socket.remoteAddress });
      return reply(401);
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return reply(400);
    }
    const { handled, ignored } = triage(payload);
    for (const item of ignored) log("oncall.ignored", item);
    let started = 0;
    for (const job of handled) {
      const key = job.playbook.id;
      if (inFlight.has(key)) {
        log("oncall.already_handling", { playbook: key });
        continue;
      }
      inFlight.add(key);
      started += 1;
      log("oncall.woke", { playbook: key, alertname: job.alert.labels.alertname });
      Promise.resolve()
        .then(() => handle(job))
        .catch((error) => log("oncall.incident_failed", { playbook: key, error: error?.name }))
        .finally(() => inFlight.delete(key));
    }
    return started > 0 ? reply(202, { accepted: started }) : reply(204);
  });
}

// --- Main -----------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = loadConfig();
  const server = createAgentServer({ config });
  server.listen(config.port, () =>
    log("oncall.started", {
      port: config.port,
      dryRun: config.dryRun,
      maxActions: config.maxActions,
      defaultToken: config.token === DEFAULT_TOKEN,
      playbooks: PLAYBOOKS.map((p) => p.id),
    }),
  );
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
