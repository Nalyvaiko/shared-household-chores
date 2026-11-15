/**
 * The pooled connection string the app uses at runtime: `DATABASE_URL`, or the
 * legacy names the Vercel Marketplace Neon integration also sets
 * (`POSTGRES_PRISMA_URL`, then `POSTGRES_URL`). The same order as
 * `scripts/vercel-build.mjs`, so a build that passes its checks also runs.
 *
 * At runtime Prisma only connects through `url`; `directUrl` (`DIRECT_URL`) is
 * read by the Prisma CLI for migrations and is not needed here.
 */
export const RUNTIME_DATABASE_URL_SOURCES = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
] as const;

export function runtimeDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const name of RUNTIME_DATABASE_URL_SOURCES) {
    if (env[name]) return env[name];
  }
  return undefined;
}
