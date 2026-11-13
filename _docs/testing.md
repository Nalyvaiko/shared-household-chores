# Testing

## Tooling

- [Vitest](https://vitest.dev) is the test runner. Config: `vitest.config.mts`.
- Environment is `jsdom`, so component and DOM tests work without extra setup.
- The `@/*` import alias resolves in tests (Vite `resolve.tsconfigPaths`).

## Conventions

- Name test files `*.test.ts` or `*.test.tsx` (`*.spec.*` also runs).
- Co-locate a test with the module it covers, or put cross-cutting tests in
  `tests/`.
- Import test helpers explicitly: `import { describe, it, expect } from "vitest"`.
  Globals are not enabled.
- Keep tests deterministic and offline. Mock the session and database rather than
  hitting a real Postgres instance (see the auth-helper tasks in
  [`tasks.md`](tasks.md)). Only the end-to-end smoke tests below use a real
  database.
- Server-only modules (`lib/auth/guards.ts`) start with `import "server-only"`,
  which throws outside a Next.js server build. `vitest.setup.ts` (listed in
  `setupFiles`) mocks it for every test file with
  `vi.mock("server-only", () => ({}))`, so tests that import such a module,
  directly or through a page or the header, need no extra setup.
- React `cache()` does not deduplicate calls under Vitest (it only caches inside
  a server request), so do not assert that a cached function runs once.
- `redirect()` from `next/navigation` throws. Mock it with a function that throws
  too, and assert with `rejects.toThrow("NEXT_REDIRECT")` plus the target URL.

## Commands

- `npm test` — run once (used by CI).
- `npm run test:watch` — watch mode for local development.
- `npm run test:e2e` — Playwright end-to-end smoke tests (see below).

## End-to-end smoke tests

[Playwright](https://playwright.dev) (Chromium only) drives the production build
against a real, migrated Postgres. Config: `playwright.config.ts`; specs live in
`e2e/` and are excluded from Vitest.

- The config starts the server itself on <http://localhost:3100>: locally
  `npm run build && npm start`, in CI only `npm start` (the Build step already
  built). It sets `AUTH_URL`, `AUTH_TRUST_HOST=true` and a test `AUTH_SECRET`
  (unless one is set); `DATABASE_URL` / `DIRECT_URL` come from the environment
  or `.env`.
- Each spec signs up its own users (unique emails) and household, so specs run
  in any order and in parallel, and a database that already has data is fine.
- Use accessible locators (`getByRole`, `getByLabel`), not CSS selectors.
- Keep the suite to a few smoke paths; logic belongs in Vitest tests.

Run locally against the Docker Postgres:

```bash
docker compose up -d                # Postgres on localhost:5432
npx prisma migrate deploy           # uses DATABASE_URL / DIRECT_URL from .env
npx playwright install chromium     # once per Playwright version
npm run test:e2e
```

In CI the job runs it after the Build step and uploads `playwright-report/` as an
artifact when it fails.

## Scope for the MVP

Add unit tests for anything with real logic: authorization helpers, recurrence
roll-over date math, invite-token validation, and Server Action validation. UI
that is pure markup does not need a test.
