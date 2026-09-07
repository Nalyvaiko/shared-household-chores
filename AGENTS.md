# shared-household-chores

Web app for managing shared household chores. Not scaffolded yet.

## Rules

- Read `_docs/plan.md` (scope, decisions) before any planning work; it is the source of truth for what is in and out of scope.
- Follow `process.md`: work one GitHub issue at a time; read its Acceptance criteria before starting and before closing.
- `_docs/tasks.md` and the GitHub issues are one-to-one — keep them in sync when tasks change.
- Branch off `main`; do not commit directly to `main`.
- Keep planning docs in `_docs/`.

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
