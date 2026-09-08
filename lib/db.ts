import { PrismaClient } from "@prisma/client";

// A single PrismaClient for the whole process. In development Next.js reloads
// modules on every change (HMR); without this cache each reload would construct
// a new client and open another pool of database connections until Postgres
// refuses them. In production the module is evaluated once, so the cache is
// skipped.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
