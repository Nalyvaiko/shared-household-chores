# shared-household-chores

Web app for managing shared household chores. Next.js App Router project
scaffolded at the repo root (TypeScript, ESLint, Vitest).

## Docs — read when relevant

- `_docs/plan.md` — scope, product decisions, fixed tech stack. Source of truth.
- `_docs/process.md` — how to work: one issue at a time, acceptance criteria, commit often.
- `_docs/tasks.md` — MVP backlog, one-to-one with the GitHub issues.
- `_docs/testing.md` — test tooling (Vitest) and conventions.
- `_docs/design.md` — UI rules. Not created yet; add it here when UI work starts (Tailwind + shadcn/ui defaults until then).

## Rules

- Read `_docs/plan.md` before planning work; do not expand scope past it.
- Follow `_docs/process.md`.
- Keep `_docs/tasks.md` and the GitHub issues in sync when tasks change.
- Branch off `main`; do not commit directly to `main`.
- Keep planning and reference docs in `_docs/`.

## Stack (fixed in `_docs/plan.md`)

- Next.js (App Router), Server Actions for all mutations
- PostgreSQL + Prisma
- Auth.js v5 Credentials + bcrypt
- Tailwind CSS + shadcn/ui
- Vercel
- No message queue, no Redis, no transactional email in the MVP

## Commands

- `npm install` — install dependencies
- `npm run dev` — dev server on <http://localhost:3000>
- `npm run build` — production build
- `npm test` — run the Vitest suite once (`npm run test:watch` for watch mode)
- `npm run lint` — ESLint
- `npm run typecheck` — `next typegen` then `tsc --noEmit`

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and build on every push
and pull request.

## Next.js version

This is Next.js 16 (App Router, Turbopack). Its APIs and conventions differ from
older docs and training data — check `node_modules/next/dist/docs/` before writing
framework code. The `next dev` AGENTS.md auto-append is disabled via
`agentRules: false` in `next.config.ts`.

## Environment

- Repo: `Nalyvaiko/shared-household-chores` (public). GitHub auth over SSH as `Nalyvaiko`.
- `gh` CLI: `C:\Program Files\GitHub CLI\gh.exe` (may not be on PATH).
