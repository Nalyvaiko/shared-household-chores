import { describe, expect, it } from "vitest";

import {
  looksSensitive,
  redactSql,
  scrubAttributes,
  scrubSpanName,
} from "@/lib/observability/privacy";

describe("scrubAttributes", () => {
  it("keeps allowed names whose values pass their check", () => {
    expect(
      scrubAttributes({
        "chore.id": "clx0abc123def456ghi789jkl",
        "chore.outcome": "not-assignee",
        "chore.recurrence": "weekly",
        "chore.rolled_over": true,
        "http.method": "POST",
        "http.status_code": 200,
        "next.route": "/chores",
        "db.system": "postgresql",
        "error.type": "PrismaClientKnownRequestError",
      }),
    ).toEqual({
      "chore.id": "clx0abc123def456ghi789jkl",
      "chore.outcome": "not-assignee",
      "chore.recurrence": "weekly",
      "chore.rolled_over": true,
      "http.method": "POST",
      "http.status_code": 200,
      "next.route": "/chores",
      "db.system": "postgresql",
      "error.type": "PrismaClientKnownRequestError",
    });
  });

  it("drops customer data, credentials and any name not on the allow-list", () => {
    const scrubbed = scrubAttributes({
      "user.email": "alex@example.com",
      "user.name": "Alex",
      "user.id": "clx0abc123def456ghi789jkl",
      "household.id": "clx0abc123def456ghi789jkl",
      "chore.title": "Take out the bins",
      "chore.skip_reason": "Away this week",
      password: "hunter2hunter2",
      "http.request.header.cookie": "authjs.session-token=abc",
      "http.request.header.authorization": "Bearer abc.def.ghi",
      "http.target": "/invite/s3cr3t-invite-token?x=1",
      "http.url": "http://localhost:3000/chores?filter=mine",
      "url.query": "callbackUrl=%2F",
      "db.connection_string": "postgresql://chores:chores@db:5432/chores",
      "invite.token": "s3cr3t-invite-token",
    });
    expect(scrubbed).toEqual({});
  });

  it("drops an allowed name whose value fails its check", () => {
    expect(
      scrubAttributes({
        "chore.outcome": "Take out the bins",
        "chore.recurrence": "yearly",
        "chore.id": "alex@example.com",
        "chore.rolled_over": "yes",
        "http.method": "alex@example.com",
        "error.type": "Error: password for alex@example.com is wrong",
      }),
    ).toEqual({});
  });

  it("masks invite tokens and query strings in route-like values", () => {
    expect(scrubAttributes({ "next.span_name": "GET /invite/abc123" })).toEqual({
      "next.span_name": "GET /invite/[token]",
    });
    expect(scrubAttributes({ "next.span_name": "GET /chores?token=abc" })).toEqual({
      "next.span_name": "GET /chores",
    });
  });

  it("redacts literals in SQL text", () => {
    expect(
      scrubAttributes({
        "db.statement": `SELECT "id" FROM "User" WHERE "email" = 'alex@example.com' AND "id" = $1 LIMIT 1`,
      }),
    ).toEqual({
      "db.statement": `SELECT "id" FROM "User" WHERE "email" = '?' AND "id" = $1 LIMIT ?`,
    });
  });

  it("ignores inherited names", () => {
    expect(scrubAttributes({ constructor: "x", toString: "y" })).toEqual({});
  });
});

describe("scrubSpanName", () => {
  it("removes query strings and invite tokens", () => {
    expect(scrubSpanName("GET /signin?callbackUrl=%2Fchores")).toBe("GET /signin");
    expect(scrubSpanName("GET /invite/s3cr3t-token")).toBe("GET /invite/[token]");
    expect(scrubSpanName("GET /invite/[token]")).toBe("GET /invite/[token]");
    expect(scrubSpanName("chores.complete")).toBe("chores.complete");
  });

  it("replaces a name that still looks sensitive", () => {
    expect(scrubSpanName("lookup alex@example.com")).toBe("redacted");
  });
});

describe("looksSensitive / redactSql", () => {
  it("flags emails, bearer tokens, JWTs and connection strings", () => {
    expect(looksSensitive("alex@example.com")).toBe(true);
    expect(looksSensitive("Bearer abc")).toBe(true);
    expect(looksSensitive("eyJhbGciOiJIUzI1NiJ9.e30.x")).toBe(true);
    expect(looksSensitive("postgresql://u:p@h/db")).toBe(true);
    expect(looksSensitive("chores.complete")).toBe(false);
  });

  it("keeps placeholders and quoted identifiers", () => {
    expect(redactSql(`SELECT "t0"."id" FROM "Chore" AS "t0" WHERE "t0"."id" = $1 OFFSET 0`)).toBe(
      `SELECT "t0"."id" FROM "Chore" AS "t0" WHERE "t0"."id" = $1 OFFSET ?`,
    );
  });
});
