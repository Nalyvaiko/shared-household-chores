import { defineConfig } from "vitest/config";

// Integration tests: the real Server Actions and Prisma client against a real,
// migrated Postgres. Only the session, `redirect()` and cache revalidation are
// mocked (integration/setup.ts). `npm run test:integration` runs them;
// `npm run test:all` creates and migrates the database first.
//
// Every test truncates all tables, so the suite refuses to run against a
// database whose name does not end in `_test`, except in CI, whose database
// is thrown away with the job.
const url =
  process.env.TEST_DATABASE_URL ??
  `postgresql://chores:chores@localhost:${process.env.CHORES_DB_PORT || "5432"}/chores_test?schema=public`;

const databaseName = new URL(url).pathname.slice(1);
if (!databaseName.endsWith("_test") && !process.env.CI) {
  throw new Error(
    `Integration tests truncate every table; refusing to run against "${databaseName}". ` +
      "Point TEST_DATABASE_URL at a database whose name ends in _test.",
  );
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["integration/**/*.int.test.ts"],
    setupFiles: ["./integration/setup.ts"],
    // One database for every file: files run one at a time so a truncate
    // never lands in the middle of another file's test.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Set before any module loads, so Prisma never falls back to `.env`.
    env: {
      DATABASE_URL: url,
      DIRECT_URL: url,
    },
  },
});
