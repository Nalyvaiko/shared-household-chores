import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `lib/db.ts` is evaluated fresh in every test (`vi.resetModules()`), so each
// case exercises the module's top-level logic from scratch:
//   export const db = globalForPrisma.prisma ?? new PrismaClient();
//   if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

type GlobalWithPrisma = typeof globalThis & { prisma?: unknown };

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function clearCachedClient() {
  delete (globalThis as GlobalWithPrisma).prisma;
}

beforeEach(() => {
  // Prisma's client constructor reads DATABASE_URL from the environment even
  // though these tests never open a connection.
  process.env.DATABASE_URL =
    ORIGINAL_DATABASE_URL ??
    "postgresql://user:pass@localhost:5432/db?schema=public";
  vi.resetModules();
  clearCachedClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@prisma/client");
  vi.resetModules();
  clearCachedClient();
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

describe("lib/db", () => {
  it("exports a client with the PrismaClient surface", async () => {
    const { db } = await import("./db");

    expect(db).toBeDefined();
    expect(typeof db.$connect).toBe("function");
    expect(typeof db.$disconnect).toBe("function");
    expect(typeof db.$transaction).toBe("function");
  });

  it("caches the client on globalThis outside production", async () => {
    const { db } = await import("./db");

    expect((globalThis as GlobalWithPrisma).prisma).toBe(db);
  });

  it("reuses an existing globalThis client instead of building a new one (HMR)", async () => {
    const existing = { sentinel: true };
    (globalThis as GlobalWithPrisma).prisma = existing;

    const { db } = await import("./db");

    expect(db as unknown).toBe(existing);
  });

  it("constructs exactly one client on a cold start", async () => {
    const construct = vi.fn();
    vi.doMock("@prisma/client", () => ({
      PrismaClient: class {
        constructor(...args: unknown[]) {
          construct(...args);
        }
      },
    }));

    const { db } = await import("./db");

    expect(construct).toHaveBeenCalledTimes(1);
    expect((globalThis as GlobalWithPrisma).prisma).toBe(db);
  });

  it("does not write to globalThis in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await import("./db");

    expect((globalThis as GlobalWithPrisma).prisma).toBeUndefined();
  });
});
