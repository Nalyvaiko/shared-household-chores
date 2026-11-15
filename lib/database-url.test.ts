import { describe, expect, it } from "vitest";

import { DATABASE_ENV_SOURCES } from "../scripts/vercel-build.mjs";
import { RUNTIME_DATABASE_URL_SOURCES, runtimeDatabaseUrl } from "./database-url";

describe("runtimeDatabaseUrl", () => {
  it("prefers DATABASE_URL", () => {
    expect(
      runtimeDatabaseUrl({
        DATABASE_URL: "postgresql://pooled",
        POSTGRES_PRISMA_URL: "postgresql://legacy-prisma",
        POSTGRES_URL: "postgresql://legacy",
      }),
    ).toBe("postgresql://pooled");
  });

  it("falls back to the legacy Neon names, POSTGRES_PRISMA_URL first", () => {
    expect(
      runtimeDatabaseUrl({
        DATABASE_URL: "",
        POSTGRES_PRISMA_URL: "postgresql://legacy-prisma",
        POSTGRES_URL: "postgresql://legacy",
      }),
    ).toBe("postgresql://legacy-prisma");
    expect(runtimeDatabaseUrl({ POSTGRES_URL: "postgresql://legacy" })).toBe(
      "postgresql://legacy",
    );
  });

  it("is undefined when none is set", () => {
    expect(runtimeDatabaseUrl({})).toBeUndefined();
  });

  it("uses the same order as the Vercel build", () => {
    expect([...RUNTIME_DATABASE_URL_SOURCES]).toEqual(DATABASE_ENV_SOURCES.DATABASE_URL);
  });
});
