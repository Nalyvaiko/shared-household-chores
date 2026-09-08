import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Prisma's client constructor reads DATABASE_URL from the environment even
// though it does not connect until the first query. Give it a value so these
// tests never depend on a real database.
const ORIGINAL_URL = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.DATABASE_URL =
    ORIGINAL_URL ?? "postgresql://user:pass@localhost:5432/db?schema=public";
});

afterEach(() => {
  process.env.DATABASE_URL = ORIGINAL_URL;
});

describe("lib/db", () => {
  it("exports one PrismaClient instance, reused across imports", async () => {
    const a = await import("./db");
    const b = await import("./db");
    expect(a.db).toBe(b.db);
  });

  it("caches the client on globalThis outside production", async () => {
    const { db } = await import("./db");
    expect((globalThis as { prisma?: unknown }).prisma).toBe(db);
  });
});
