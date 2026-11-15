import { PrismaClient } from "@prisma/client";

import { runtimeDatabaseUrl } from "./database-url";

// A single PrismaClient for the whole process. In development Next.js reloads
// modules on every change (HMR); without this cache each reload would construct
// a new client and open another pool of database connections until Postgres
// refuses them. In production the module is evaluated once, so the cache is
// skipped.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// `datasourceUrl` overrides the schema's `env("DATABASE_URL")`, so the legacy
// Neon names work too. Unset → Prisma's own lookup (and its usual error).
function createClient(): PrismaClient {
  const url = runtimeDatabaseUrl();
  return url ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient();
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
