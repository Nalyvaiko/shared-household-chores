/**
 * On-call playbooks: which alert each one handles, and what to do given the
 * facts the agent gathered. Pure functions, no I/O, so every decision can be
 * unit-tested (tests/oncall-agent.test.ts).
 *
 * A decision is either `act` (one or more allow-listed actions, then verify)
 * or `escalate` (no action; the incident report says a human is needed).
 * Reasons are fixed strings written here, never text taken from the alert.
 */

/** The only actions the agent can take, and the Compose services they may target. */
export const ALLOWED_ACTIONS = Object.freeze({
  start: Object.freeze(["db", "app"]),
  restart: Object.freeze(["db", "app"]),
});

/** True when `action` is on the allow-list (type and target service). */
export function isAllowedAction(action) {
  if (!action || typeof action !== "object") return false;
  if (!Object.hasOwn(ALLOWED_ACTIONS, action.type)) return false;
  return ALLOWED_ACTIONS[action.type].includes(action.service);
}

const act = (reason, ...actions) => ({ kind: "act", reason, actions, needsHuman: false });
const escalate = (reason) => ({ kind: "escalate", reason, actions: [], needsHuman: true });

/**
 * "Chore completions failing": the Complete Server Action threw, almost always
 * because the database is down or unreachable.
 *
 * @param {{
 *   containers: Record<string, { exists: boolean, state?: string, health?: string }>,
 *   dbReachable: boolean,
 *   signinStatus: number | null,
 * }} facts
 */
export function decideCompletionsFailing(facts) {
  const db = facts.containers.db ?? { exists: false };
  const app = facts.containers.app ?? { exists: false };

  if (!db.exists) return escalate("database container not found in this compose project");
  if (db.state !== "running") {
    return act(`database container is ${stateWord(db.state)}`, { type: "start", service: "db" });
  }
  if (db.health === "unhealthy") {
    return act("database container is unhealthy", { type: "restart", service: "db" });
  }
  if (db.health === "starting") return escalate("database container is still starting");
  if (!facts.dbReachable) {
    return escalate("database container is running but port 5432 is not reachable");
  }

  // The database is fine. The app container is optional (with `npm run dev`
  // the app runs on the host); act on it only when it is part of the project.
  if (app.exists && app.state !== "running") {
    return act(`app container is ${stateWord(app.state)} while the database is healthy`, {
      type: "start",
      service: "app",
    });
  }
  if (app.exists && app.health === "unhealthy") {
    return act("app container is unhealthy while the database is healthy", {
      type: "restart",
      service: "app",
    });
  }
  return escalate("database and app look healthy; no known cause, needs a human");
}

/** "Chore completions slow": diagnose only, never act. */
export function decideCompletionsSlow() {
  return escalate("slow completions are diagnosed only; needs a human");
}

const KNOWN_STATES = ["created", "running", "paused", "restarting", "removing", "exited", "dead"];
const stateWord = (state) => (KNOWN_STATES.includes(state) ? state : "not running");

/**
 * The playbooks, matched in order against a firing alert's labels.
 * `ruleUid` is the Grafana rule whose state the verification step polls.
 */
export const PLAYBOOKS = Object.freeze([
  Object.freeze({
    id: "completions-failing",
    match: { alertname: "Chore completions failing", journey: "complete-chore" },
    ruleUid: "chores-complete-failing",
    decide: decideCompletionsFailing,
  }),
  Object.freeze({
    id: "completions-slow",
    match: { alertname: "Chore completions slow", journey: "complete-chore" },
    ruleUid: "chores-complete-slow",
    decide: decideCompletionsSlow,
  }),
]);

/** The playbook whose labels all match, or undefined. */
export function findPlaybook(labels, playbooks = PLAYBOOKS) {
  if (!labels || typeof labels !== "object") return undefined;
  return playbooks.find((playbook) =>
    Object.entries(playbook.match).every(([key, value]) => labels[key] === value),
  );
}
