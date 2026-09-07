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

## Commands

- `npm test` — run once (used by CI).
- `npm run test:watch` — watch mode for local development.

## Scope for the MVP

Add unit tests for anything with real logic: authorization helpers, recurrence
roll-over date math, invite-token validation, and Server Action validation. UI
that is pure markup does not need a test.
