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
  [`tasks.md`](tasks.md)).
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

## Scope for the MVP

Add unit tests for anything with real logic: authorization helpers, recurrence
roll-over date math, invite-token validation, and Server Action validation. UI
that is pure markup does not need a test.
