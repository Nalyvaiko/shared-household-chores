# Testing

## Three layers

| Layer | Where | Runs against | What it proves | Command |
| --- | --- | --- | --- | --- |
| Unit | `*.test.ts(x)` next to the code, `tests/` | Mocked session and database (jsdom) | Logic and branches: validation, date math, every refusal an action can give, which queries it makes | `npm test` / `npm run test:unit` |
| Integration | `integration/*.int.test.ts` | The real Server Actions and Prisma client on a real Postgres (`chores_test`) | What mocks cannot: rows actually written, cascades and `SET NULL`, and that the row locks keep parallel requests consistent | `npm run test:integration` |
| End-to-end | `e2e/*.spec.ts` | The production build in Chromium, real Postgres | The main user paths work through the UI | `npm run test:e2e` |

`npm run test:all` runs all three with one command — see
[One command](#one-command-test-all).

## Tooling

- [Vitest](https://vitest.dev) is the test runner. Config: `vitest.config.mts`
  (unit) and `vitest.integration.config.mts` (integration).
- Environment is `jsdom`, so component and DOM tests work without extra setup.
- The `@/*` import alias resolves in tests (Vite `resolve.tsconfigPaths`).

## Conventions

- Name test files `*.test.ts` or `*.test.tsx` (`*.spec.*` also runs).
- Co-locate a test with the module it covers, or put cross-cutting tests in
  `tests/`.
- Import test helpers explicitly: `import { describe, it, expect } from "vitest"`.
  Globals are not enabled.
- Keep unit tests deterministic and offline. Mock the session and database
  rather than hitting a real Postgres instance (see the auth-helper tasks in
  [`tasks.md`](tasks.md)). Only the integration and end-to-end tests below use
  a real database.
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

- `npm test` (alias `npm run test:unit`) — unit tests once (used by CI).
- `npm run test:watch` — unit tests in watch mode for local development.
- `npm run test:integration` — integration tests (see below).
- `npm run test:e2e` — Playwright end-to-end smoke tests (see below).
- `npm run test:e2e:remote` — the same specs against a deployed app at
  `E2E_BASE_URL` (required), with no local server. Specs must keep creating
  their own users and households (unique emails via `uniqueEmail`) so this stays
  safe against production.
- `npm run test:all` — every layer, with the database set up for you (see below).

## Integration tests

Vitest in the `node` environment, config `vitest.integration.config.mts`,
files `integration/**/*.int.test.ts` (excluded from the unit run). They call the
real Server Actions and `lib/` functions with the real Prisma client.

- **Database.** `TEST_DATABASE_URL`, default
  `postgresql://chores:chores@localhost:${CHORES_DB_PORT:-5432}/chores_test`.
  The config sets `DATABASE_URL` / `DIRECT_URL` to it before anything loads, so
  `.env` is never used. Every test truncates all tables first, so the config
  refuses a database whose name does not end in `_test` (outside CI).
- **Mocks** (`integration/setup.ts`), only for what has no server in a test:
  `@/auth` (the session), `next/navigation` `redirect()` (throws
  `NEXT_REDIRECT <url>`, like Next), `next/cache` revalidation, `server-only`.
- **Callers.** `asUser(userId, () => action(...))` (`integration/session.ts`)
  sets the session per async call chain, so one test can fire parallel
  requests as different users with `Promise.all`.
- **Fixtures.** `integration/helpers.ts` creates users, households, members and
  chores directly with Prisma; `redirectOf()` returns a redirect's target.
  Each test seeds only what it needs.
- **What belongs here:** behaviour that depends on Postgres — roll-over rows,
  cascades, `SET NULL`, unique constraints, and races the locks must win
  (repeat a race a few rounds so a missing lock fails reliably). Branch logic
  stays in unit tests.
- Files run one at a time (one shared database); tests within a file run in
  order.

Run on their own against the Docker Postgres:

```bash
docker compose up -d --wait db
# once: create chores_test and migrate it (npm run test:all does both)
docker compose exec -T db psql -U chores -d chores -c "CREATE DATABASE chores_test"
DATABASE_URL=postgresql://chores:chores@localhost:5432/chores_test \
DIRECT_URL=postgresql://chores:chores@localhost:5432/chores_test \
  npx prisma migrate deploy
npm run test:integration
```

In CI the step runs after the unit tests against the job's Postgres service
(`TEST_DATABASE_URL` = the service database, which is thrown away with the
job).

## One command (`test:all`)

`npm run test:all` ([`scripts/test-all.mjs`](../scripts/test-all.mjs), plain
Node, no dependencies) needs only Docker running and the Playwright browser
installed (`npx playwright install chromium`, once per version):

1. `docker compose up -d --wait db` — starts the Compose Postgres and waits until
   it is healthy (the same step as `npm run dev:all`). If Docker is not
   reachable it says so in one line and exits 1; the same for a missing
   Playwright Chromium, before any test runs.
2. Creates `chores_test` on that server if it is missing. The development
   database (`chores`) is never reset, seeded or dropped.
3. `prisma migrate deploy` against `chores_test`.
4. Unit → integration → end-to-end, every step with `DATABASE_URL` /
   `DIRECT_URL` pointed at `chores_test` (so Playwright's server uses it too).

The first failing step stops the run with its exit code; a summary with each
step's duration is printed at the end. `.env` is never written.
`CHORES_DB_PORT` and `COMPOSE_PROJECT_NAME` work as for `npm run dev:all`, e.g.
a throwaway stack next to your usual one:

```bash
COMPOSE_PROJECT_NAME=chores-tests CHORES_DB_PORT=55432 npm run test:all
docker compose -p chores-tests down -v   # remove it afterwards
```

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
docker compose up -d --wait db      # Postgres on localhost:5432
npx prisma migrate deploy           # uses DATABASE_URL / DIRECT_URL from .env
npx playwright install chromium     # once per Playwright version
npm run test:e2e
```

In CI the job runs it after the Build step and uploads `playwright-report/` as an
artifact when it fails.

## Docker image check

The Docker setup (`Dockerfile`, the `app` service in `docker-compose.yml`,
`docker/entrypoint.mjs`) is covered twice:

- **Unit:** `tests/docker.test.ts` asserts the wiring — base image, standalone
  copy, non-root user, the `app` service's environment, port, `depends_on` and
  healthcheck, and the entrypoint's steps (`migrate deploy`, then the seed with
  `--skip-if-seeded`).
- **CI:** the `docker` job in `.github/workflows/ci.yml` runs
  `docker compose up -d --build --wait`, expects `GET /signin` to return 200
  and the demo household to exist, prints the Compose logs on failure, and
  always runs `docker compose down -v`.

To check it by hand without touching your usual database, use a separate
project and ports, then remove it:

```bash
COMPOSE_PROJECT_NAME=docker-check CHORES_DB_PORT=55442 APP_PORT=3142 docker compose up -d --build --wait
curl -I http://localhost:3142/signin
docker compose -p docker-check down -v
```

## Observability (telemetry)

Telemetry is off in every test layer and in CI: nothing sets
`OTEL_EXPORTER_OTLP_ENDPOINT`, so `instrumentation.ts` registers no SDK and the
spans, metrics and log records in `lib/observability/` are no-ops. Both Vitest
configs set `LOG_LEVEL=silent`, so the journey's JSON log lines stay off the
test output.

- **Unit:** `lib/observability/privacy.test.ts` (the allow-list drops emails,
  titles, passwords, cookies, headers, invite tokens, query strings, ids other
  than the chore's; SQL literals are redacted) and
  `lib/observability/telemetry-signals.test.ts` (a real SDK with in-memory
  exporters behind the scrubbing wrappers: exported spans and log records hold
  no secrets, log lines carry the active span's `trace_id`/`span_id`, the
  journey records its span, metrics and logs under one trace, a redirect is
  not an error). `instrumentation.test.ts` checks the SDK starts only with an
  endpoint and only in the Node.js runtime. `tests/docker.test.ts` checks the
  `observability` Compose profile and the dashboard.
- **By hand, end to end:** run the stack on separate ports, drive the journey,
  then query the backends through Grafana's datasource proxy:

```bash
COMPOSE_PROJECT_NAME=obs-check CHORES_DB_PORT=55443 APP_PORT=3143 \
  OBSERVABILITY_UI_PORT=3144 OTLP_HTTP_PORT=4319 \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://observability:4318 \
  docker compose --profile observability up -d --build --wait
E2E_BASE_URL=http://localhost:3143 npx playwright test e2e/chore-lifecycle.spec.ts
G=http://localhost:3144/api/datasources/proxy/uid
curl "$G/tempo/api/search?tags=service.name%3Dshared-household-chores"
curl -G "$G/loki/loki/api/v1/query_range" --data-urlencode 'query={service_name="shared-household-chores"}'
curl "$G/prometheus/api/v1/query?query=chores_completions_total"
docker compose -p obs-check --profile observability down -v
```

## Scope for the MVP

Add unit tests for anything with real logic: authorization helpers, recurrence
roll-over date math, invite-token validation, and Server Action validation. Add
an integration test when the behaviour lives in the database: a new lock, a
cascade, or a constraint. UI that is pure markup does not need a test.
