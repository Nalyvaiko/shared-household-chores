# shared-household-chores

Web app for managing shared household chores. Not scaffolded yet.

## Docs — read when relevant

- `_docs/plan.md` — scope, product decisions, fixed tech stack. Source of truth.
- `_docs/process.md` — how to work: one issue at a time, acceptance criteria, commit often.
- `_docs/tasks.md` — MVP backlog, one-to-one with the GitHub issues.
- `_docs/testing.md` — test rules. Not created yet; add it here when scaffolding (task 1).
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

_None yet — add install / dev / test / lint / typecheck / build here after task 1._

## Environment

- Repo: `Nalyvaiko/shared-household-chores` (public). GitHub auth over SSH as `Nalyvaiko`.
- `gh` CLI: `C:\Program Files\GitHub CLI\gh.exe` (may not be on PATH).
