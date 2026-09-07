# shared-household-chores

A simple web app for managing shared household chores for any group — couples,
families, roommates. In planning/setup: no application code yet.

## Read these first

- `_docs/plan.md` — MVP scope, product decisions, and the target tech stack.
  Source of truth for what is in and out of scope.
- `_docs/tasks.md` — the MVP backlog: 21 tasks, each sized for a single working
  session and written to be picked up without reading the others. The numbering
  is a suggested order, not a hard dependency chain.

## Target tech stack (decided in `_docs/plan.md`)

- Next.js (App Router), Server Actions for all mutations
- PostgreSQL + Prisma
- Auth.js v5 Credentials provider + bcrypt (email/password; no password reset in MVP)
- Tailwind CSS + shadcn/ui
- Deployed on Vercel

The plan was deliberately trimmed so the whole app fits this stack: no message
queue, no Redis, no transactional email in the MVP. "Overdue" is derived at read
time; recurring chores roll over synchronously inside the completion transaction;
invites are share links, not emails.

## GitHub & tooling

- Canonical repo: `Nalyvaiko/shared-household-chores` (public).
- The task backlog in `_docs/tasks.md` is mirrored one-to-one as GitHub issues.
  Keep the two in sync when tasks are added, split, or merged.
- GitHub CLI is installed at `C:\Program Files\GitHub CLI\gh.exe`; it may not be
  on PATH — call it by full path if `gh` is not found.
- GitHub auth is over SSH as user `Nalyvaiko` (`~/.ssh/id_ed25519`).

## Conventions

- Branch off `main` for changes; do not commit directly to `main`.
- Keep `_docs/` as the home for planning docs (scope, backlog, design notes).
