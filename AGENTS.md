# shared-household-chores

Web app for managing shared household chores. Next.js App Router project
scaffolded at the repo root (TypeScript, ESLint, Vitest, Playwright).

## Docs — read when relevant

- `README.md` — product overview, local setup, environment variables, deploy runbook, project management.
- `_docs/plan.md` — scope, product decisions, fixed tech stack. Source of truth.
- `_docs/process.md` — how to work: one issue at a time, acceptance criteria, commit often.
- `_docs/team/README.md` — agent team: roles, handoffs, artifacts.
- `_docs/team/pm.md` — PM role: grooming issues, acceptance criteria, scope calls.
- `_docs/team/software-engineer.md` — Software Engineer role: implementing an issue, checks, PRs.
- `_docs/team/qa-engineer.md` — QA Engineer role: verifying an issue against its criteria.
- `_docs/tasks.md` — MVP backlog, one-to-one with the GitHub issues.
- `_docs/task-template.md` — the four-section GitHub issue template.
- `_docs/testing.md` — test tooling (Vitest, Playwright) and conventions.
- `_docs/design.md` — UI conventions (components, row actions, feedback, forms, accessibility, narrow screens). Read before UI work.

## Read by task

Load only the docs the job needs.

| Job | Read |
| --- | --- |
| Planning or scoping | `_docs/plan.md` |
| Grooming an issue | `_docs/team/pm.md`, `_docs/task-template.md`, `_docs/tasks.md` |
| Implementing an issue | `_docs/team/software-engineer.md`, `_docs/testing.md` (+ `_docs/design.md` for UI), the Next.js version note below |
| Verifying an issue | `_docs/team/qa-engineer.md`, the issue's acceptance criteria |
| Process and handoffs | `_docs/process.md`, `_docs/team/README.md` |
| Setup, deploy, env vars | `README.md` |

## Rules

- Read `_docs/plan.md` before planning work; do not expand scope past it.
- Follow `_docs/process.md`.
- Keep `_docs/tasks.md` and the GitHub issues in sync when tasks change.
- Branch off `main`; do not commit directly to `main`.
- Keep planning and reference docs in `_docs/`.

## Stack (fixed in `_docs/plan.md`)

- Next.js (App Router), Server Actions for all mutations
- PostgreSQL + Prisma, pinned to `^6.19.3` (`prisma` and `@prisma/client`); do not upgrade to Prisma 7
- Auth.js v5 Credentials + bcrypt
- Tailwind CSS + shadcn/ui
- Vitest for unit tests, Playwright for end-to-end tests
- Vercel
- No message queue, no Redis, no transactional email in the MVP

## Commands

- `npm install` — install dependencies (`postinstall` runs `prisma generate`)
- `npm run dev:all` — one-command local run: starts the Compose Postgres (waits until healthy), `prisma migrate deploy`, seeds only if not seeded yet, then `next dev`; uses the `.env.example` defaults when there is no `.env`
- `npm run dev` — dev server on <http://localhost:3000>
- `npm run build` — production build
- `npm test` — run the Vitest unit suite once (alias `npm run test:unit`; `npm run test:watch` for watch mode)
- `npm run test:integration` — Vitest integration tests: real Server Actions + Prisma against the `chores_test` database (never the dev DB)
- `npm run test:e2e` — Playwright end-to-end tests
- `npm run test:all` — every layer with one command: starts the Compose Postgres, creates and migrates `chores_test`, then unit → integration → e2e against it; stops at the first failure
- `npm run lint` — ESLint
- `npm run typecheck` — `next typegen` then `tsc --noEmit`
- `npm run db:migrate` / `db:reset` / `db:seed` / `db:studio` — `prisma migrate dev`, `prisma migrate reset`, seed, Prisma Studio
- `npm run vercel-build` — used by Vercel: `prisma migrate deploy` then `next build`

CI (`.github/workflows/ci.yml`) runs on every push and pull request: it applies
the Prisma migrations to a PostgreSQL service, fails if `schema.prisma` has a change
with no migration (`prisma migrate diff`), then runs lint, typecheck, unit tests, integration tests (on the service
database), build, and the Playwright end-to-end tests.

## Next.js version

This is Next.js 16 (App Router, Turbopack). Its APIs and conventions differ from
older docs and training data — check `node_modules/next/dist/docs/` before writing
framework code. The `next dev` AGENTS.md auto-append is disabled via
`agentRules: false` in `next.config.ts`.

## Environment

- Repo: `Nalyvaiko/shared-household-chores` (public). GitHub auth over SSH as `Nalyvaiko`.
- `gh` CLI: `C:\Program Files\GitHub CLI\gh.exe` (may not be on PATH).
