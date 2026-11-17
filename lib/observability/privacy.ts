import type { AttributeValue, Attributes } from "@opentelemetry/api";

// What may leave the app as telemetry. Everything here is an allow-list:
// an attribute or log field whose name is not listed is dropped, and a listed
// one is dropped too when its value fails the check below. Applied to every
// span (ours, Next.js's and Prisma's) in the span exporter, to every log line
// by the logger, and to every metric data point by the recorders.
//
// Never sent: passwords, session tokens and cookies, Authorization and other
// HTTP headers, emails, names, chore titles, skip reasons, invite tokens,
// database connection strings, query parameter values, URLs with query
// strings, user ids and household ids. A chore id (an opaque random cuid that
// says nothing about a person) is the one record id allowed, so a refusal can
// be matched to its row while debugging.

const OUTCOMES = [
  "completed",
  "not-pending",
  "unclaimed",
  "not-assignee",
  "gone",
  "caller-gone",
  "error",
] as const;
export type CompletionOutcome = (typeof OUTCOMES)[number];

const RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;

const CUID = /^[a-z0-9]{20,32}$/;
const IDENTIFIER = /^[A-Za-z0-9_.:\-[\]/() ]{1,128}$/;

type Check = (value: AttributeValue) => AttributeValue | undefined;

const oneOf =
  (allowed: readonly string[]): Check =>
  (value) =>
    typeof value === "string" && allowed.includes(value) ? value : undefined;
const bool: Check = (value) => (typeof value === "boolean" ? value : undefined);
const num: Check = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const matching =
  (pattern: RegExp): Check =>
  (value) =>
    typeof value === "string" && pattern.test(value) ? value : undefined;
/** A short identifier-like string: a route pattern, a span type, a model name. */
const identifier: Check = (value) =>
  typeof value === "string" && IDENTIFIER.test(value) && !looksSensitive(value) ? value : undefined;
/** A route, page or span name: identifier-like, with invite tokens masked. */
const pathLike: Check = (value) =>
  typeof value === "string" ? identifier(scrubSpanName(value)) : undefined;
const sql: Check = (value) => (typeof value === "string" ? redactSql(value) : undefined);

/** Allowed attribute and log-field names, each with the check its value must pass. */
export const ALLOWED_ATTRIBUTES: Readonly<Record<string, Check>> = {
  // The "complete a chore" journey.
  "chore.id": matching(CUID),
  "chore.outcome": oneOf(OUTCOMES),
  "chore.recurrence": oneOf(RECURRENCES),
  "chore.rolled_over": bool,
  duration_ms: num,
  "error.type": identifier,
  // Log records.
  "event.name": identifier,
  // Next.js server spans. `http.target` and `http.url` are not here: they
  // carry the real path (an invite token) and the query string.
  "http.method": identifier,
  "http.request.method": identifier,
  "http.status_code": num,
  "http.response.status_code": num,
  "http.route": pathLike,
  "next.route": pathLike,
  "next.page": pathLike,
  "next.segment": identifier,
  "next.span_name": pathLike,
  "next.span_type": identifier,
  "next.rsc": bool,
  "next.bubble": bool,
  "operation.name": pathLike,
  // Prisma spans. The query text is parameterized ($1, $2...); literals are
  // redacted anyway, so a value can never ride along.
  "db.system": identifier,
  "db.system.name": identifier,
  "db.operation.name": identifier,
  "db.collection.name": identifier,
  "db.statement": sql,
  "db.query.text": sql,
  method: identifier,
  model: identifier,
  name: identifier,
};

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const SECRETS =
  /(bearer\s|basic\s|eyJ[A-Za-z0-9_-]{8,}|postgres(ql)?:\/\/|authjs\.|next-auth\.|password|passwd|secret|token=|cookie)/i;

/** True for a string that looks like an email, a credential or a connection string. */
export function looksSensitive(value: string): boolean {
  return EMAIL.test(value) || SECRETS.test(value);
}

/** Replaces string and numeric literals in SQL with `?`. */
export function redactSql(statement: string): string {
  return statement
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/(?<![\w$."])\b\d+(?:\.\d+)?\b/g, "?")
    .slice(0, 4096);
}

/** Keeps only allowed attribute names whose values pass their check. */
export function scrubAttributes(attributes: Attributes | undefined): Attributes {
  const clean: Attributes = {};
  if (!attributes) return clean;
  for (const [key, value] of Object.entries(attributes)) {
    const check = Object.hasOwn(ALLOWED_ATTRIBUTES, key) ? ALLOWED_ATTRIBUTES[key] : undefined;
    if (!check || value === undefined || value === null) continue;
    const kept = check(value);
    if (kept !== undefined) clean[key] = kept;
  }
  return clean;
}

/**
 * A span name without a query string or an invite token. Next.js names a
 * request span after the raw URL until it knows the route.
 */
export function scrubSpanName(name: string): string {
  const withoutQuery = name.replace(/\?\S*/g, "");
  const withoutToken = withoutQuery.replace(/\/invite\/(?!\[token\])[^\s/]+/g, "/invite/[token]");
  return looksSensitive(withoutToken) ? "redacted" : withoutToken;
}
