# shared-household-chores

Web app for managing shared household chores for couples, families, roommates, or
any other group.

**Contents:** [Live demo](#live-demo) ·
[The problem](#the-problem) ·
[What it does](#what-it-does) ·
[How it works](#how-it-works) ·
[Tech stack](#tech-stack) ·
[Project docs](#project-docs) ·
[Project management](#project-management) ·
[Getting started](#getting-started) ·
[Run with Docker](#run-with-docker) ·
[Database](#database) ·
[Scripts](#scripts) ·
[Tests](#tests) ·
[CI](#ci) ·
[Environment variables](#environment-variables) ·
[Deploy to Vercel](#deploy-to-vercel)

## Live demo

Live demo: _not deployed yet_

Sign up with any email, or sign in to the seeded demo household:

| Role   | Email               | Password           |
| ------ | ------------------- | ------------------ |
| Admin  | `admin@example.com` | `sparkle-otter-42` |
| Member | `member@example.com`| `maple-badger-77`  |

The demo accounts are shared and public, so anyone can change their data. It
runs on free tiers (Vercel Hobby and Neon), so the first request after a quiet
spell can take a few seconds while the database wakes up.

## The problem

When several people share a home, chores get tracked in heads, group chats and
sticky notes. Nobody is sure who agreed to take the bins out, whether the
bathroom was cleaned this week, or why the plants were not watered. Recurring
jobs fall through the cracks, and the same people end up doing most of the work.

This app gives a household — a couple, a family, flatmates, or any other group —
one shared list of chores. Each chore says what needs doing, by when, and who is
on it; everyone sees the same list, and each person gets a short "My chores" view
of what is theirs. Completing or skipping a chore is recorded (who, when, and why
it was skipped), and recurring chores come back on their own.

## What it does

- **Accounts** — sign up and sign in with email and password.
- **One household per user** — create a household (you become its admin) or join
  one through an invite link.
- **Invite links** — an admin generates a link and shares it any way they like;
  the app sends no email.
- **Members and roles** — two fixed roles, admin and member. Admins can remove
  members and promote or demote them.
- **Categories** — every household starts with built-in categories (Kitchen,
  Bathroom, Cleaning, Laundry, Outdoor, Pets, Admin); members can add and delete
  custom ones.
- **Chores** — a title plus an optional due date and time, priority (Low /
  Medium / High / Urgent), effort (Small / Medium / Large), optional category,
  recurrence (none / daily / weekly / monthly), and assignment: **fixed** (one or
  more named people) or **claim** (anyone can pick it up).
- **My chores** (`/`) — your pending chores: the ones you are assigned to or
  have claimed, earliest due first.
- **Household chores** (`/chores`) — every chore in the household, filtered by
  status (Pending by default, Completed, Skipped, All), **Overdue only**, and
  category (including "No category").
- **Chore actions** — complete, skip with a reason, claim, release, edit, and
  delete.
- **Household settings** — admins can rename the household.

## How it works

The rules below describe what the app enforces on the server, not only what the
UI shows.

### Chore lifecycle

- A chore is **Pending** until it is **Completed** or **Skipped**. Both are final:
  a completed or skipped chore cannot be edited, reopened, completed or skipped
  again (an admin can still delete it).
- **Overdue** is not a stored status. A chore is overdue when it is Pending and
  its due date and time is in the past; it then shows an Overdue badge and
  appears under the Overdue only filter. Chores without a due date are never
  overdue.
- **Completing** records who completed it and when. On a chore with several
  assignees, one person completing it completes it for everyone.
- **Skipping** requires a reason (up to 500 characters) and records who skipped
  it and when. The app keeps these records but has no history screen for them.
- **Recurring chores** roll over only on completion: completing one creates
  exactly one new Pending occurrence, in the same database transaction.
  - It copies the title, priority, effort, category, recurrence and assignment
    mode. A fixed chore keeps its assignees; a claim chore starts unclaimed.
  - The next due date is the previous one plus 1 day (daily), 7 days (weekly) or
    1 calendar month (monthly), keeping the time of day. Monthly dates are
    clamped to the end of a shorter month (Jan 31 → Feb 28 → Mar 28). A chore
    with no due date is scheduled from the moment it was completed.
  - The maths is done in UTC, so a time entered in local time can appear an
    hour off after a daylight-saving change.
  - There is no back-fill: completing a long-overdue daily chore creates one
    next occurrence, which may itself already be overdue.
  - **Skipping a recurring chore ends the series**: no next occurrence is
    created. Deleting one does not create one either.
  - Changing a chore's recurrence while editing takes effect at its next
    completion.
- Double submits and simultaneous actions are safe: two people completing (or
  completing and skipping) the same chore at once produce exactly one outcome,
  and the other person is told the chore was already completed or skipped.

### Assignment

- **Fixed** — specific members are assigned. Only they can complete it. If
  nobody is assigned, the chore shows as **Unassigned** and nobody can complete it
  until someone is assigned.
- **Claim** — the chore starts **Unclaimed**. Any member (admins included) can
  claim it; there is at most one claimant at a time. Only the claimant can
  complete or release it; releasing makes it Unclaimed again.
- Only the chore's creator or an admin can change its assignment mode or
  assignees. Other members can still edit its other details.
- Removing a member unassigns them from the household's chores: a fixed chore
  left with nobody shows as Unassigned, a claim they held becomes Unclaimed.
  Their completion and skip records and the chores they created stay.

### Roles and permissions

Everyone in a household sees all of its chores, members and categories.

| Action                                              | Member | Admin |
| --------------------------------------------------- | :----: | :---: |
| View all chores, members and categories             | ✓      | ✓     |
| Create a chore                                      | ✓      | ✓     |
| Edit a pending chore's details (title, due date, priority, effort, category, recurrence) | ✓ | ✓ |
| Change a chore's assignment (mode and assignees)    | Own chores only | ✓ |
| Complete a chore                                    | Assignee or claimant only | Assignee or claimant only |
| Skip a pending chore (with a reason)                | ✓      | ✓     |
| Claim an unclaimed claim chore                      | ✓      | ✓     |
| Release a claim                                     | Claimant only | Claimant only |
| Delete a chore (any status)                         | —      | ✓     |
| Add or delete custom categories                     | ✓      | ✓     |
| Generate or regenerate the invite link              | —      | ✓     |
| Remove a member                                     | —      | ✓     |
| Change a member's role                              | —      | ✓     |
| Rename the household                                | —      | ✓     |

"Own chores" means chores you created. Admins get no exception to the completion
rule: an admin who is not assigned (or has not claimed) cannot complete a chore.

Safety rules:

- You cannot remove yourself or change your own role.
- A household always keeps at least one admin: the last admin cannot be removed
  or demoted.
- Built-in categories cannot be deleted. Deleting a custom category leaves its
  chores with no category. Category names are unique per household, ignoring
  case.

### Invites

- A household has at most **one active invite link**. It is valid for **7 days**.
- Generating a new link immediately expires the previous one.
- A link can be used **once**: the first person to join with it uses it up.
- Opening a link requires signing in (or signing up, then coming back to the
  link). The invite page only shows the household's name; nothing happens until
  the visitor presses **Join**, so link previews cannot use it up.
- New members join as **member**. Someone who already belongs to a household
  cannot join another one.

### Dates and times

- Due dates are optional, entered in your browser's local time, stored in UTC,
  and shown in each viewer's local time. They must fall between the years 2000
  and 2099.
- Lists are ordered by due date, earliest first; chores without one come last.

### Out of scope for the MVP

Deliberately left out (see [`_docs/plan.md`](_docs/plan.md) for why and how each
could come back):

- Notifications of any kind (push, email, overdue or assignment reminders), and
  email invites
- Password reset
- Belonging to more than one household, or switching between households
- Rotating assignment
- Custom roles, configurable permissions or chore visibility
- Comments, photos/attachments and subtasks
- Completion history UI, statistics, leaderboards, reporting and gamification
- Calendar view

### Where the app refines the plan

[`_docs/plan.md`](_docs/plan.md) is the source of truth for scope. Where it
leaves room, the app makes these choices:

- **Completing is limited to assignees and the current claimant**, admins
  included (#27; `plan.md` was updated to match).
- **Editing is for pending chores only.** The plan says members can "edit or skip
  any chore"; in the app, completed and skipped chores are read-only, and only
  an admin can delete them.
- **Assignment changes are creator or admin only**, applying the plan's "who
  assigns a chore" rule to edits as well as creation.
- **Admins can delete chores in any status**, Pending, Completed or Skipped.
- **Invite links** are single use, expire after 7 days, and only one is active per
  household at a time.
- **Auth** uses Auth.js Credentials with bcrypt (the plan's other option, Clerk,
  is not used), so password reset stays deferred.

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router), Server Actions for all
  mutations
- PostgreSQL with [Prisma](https://www.prisma.io) 6
- [Auth.js](https://authjs.dev) v5 Credentials provider + bcrypt
- Tailwind CSS + [shadcn/ui](https://ui.shadcn.com)
- Vitest and Playwright for tests
- Deployed on Vercel with hosted Postgres (Neon, Supabase or Railway)
- No message queue, no Redis, no transactional email

## Project docs

- [`_docs/plan.md`](_docs/plan.md) — scope, product decisions and the fixed tech
  stack (source of truth)
- [`_docs/process.md`](_docs/process.md) — how work is done: one issue at a time,
  acceptance criteria
- [`_docs/tasks.md`](_docs/tasks.md) — the MVP backlog, one-to-one with the
  GitHub issues
- [`_docs/testing.md`](_docs/testing.md) — test tooling and conventions
- [`_docs/design.md`](_docs/design.md) — UI rules

## Project management

### Specification

[`_docs/plan.md`](_docs/plan.md) is the source of truth: scope, product
decisions and the fixed tech stack. Tasks, code and the rules in
[How it works](#how-it-works) follow it.

### Task tracker

Tasks live in the public GitHub Issues:
[open issues](https://github.com/Nalyvaiko/shared-household-chores/issues) ·
[all issues, including closed](https://github.com/Nalyvaiko/shared-household-chores/issues?q=is%3Aissue).

Each task issue follows [`_docs/task-template.md`](_docs/task-template.md):
**Goal**, **Acceptance criteria** (checkboxes), **Out of scope** (with links to
follow-up issues) and **Constraints**. [`_docs/tasks.md`](_docs/tasks.md)
mirrors the MVP backlog (#1–#21) plus the follow-ups filed along the way
(#23–#27).

### Workflow

From [`_docs/process.md`](_docs/process.md) and the role guides in
[`_docs/team/`](_docs/team/). The team, its handoffs and artifacts are in
[`_docs/team/README.md`](_docs/team/README.md).

1. Work on **one issue at a time**, taken from the backlog.
2. **PM** ([`pm.md`](_docs/team/pm.md)) grooms the issue into the template,
   makes every acceptance criterion checkable, and files follow-up issues for
   anything moved out of scope.
3. **Engineer** ([`software-engineer.md`](_docs/team/software-engineer.md))
   implements it on a `feat/<n>-…` branch against the acceptance criteria,
   writes tests, and posts a summary comment on the issue. The Engineer does
   not close the issue.
4. **QA** ([`qa-engineer.md`](_docs/team/qa-engineer.md)) checks every
   criterion against the running code, runs the tests, and posts a verdict
   comment starting `## QA: PASS` or `## QA: FAIL`, with a verdict for each
   criterion. QA reports problems but does not fix them.
5. On **FAIL** the issue goes back to the Engineer with the QA comment as
   input, then to QA again.
6. On **PASS** the issue is closed with its criteria ticked. Its pull request
   says `Resolves #<n>`.

### Where to see it

- [Issue #16 — Complete a chore](https://github.com/Nalyvaiko/shared-household-chores/issues/16):
  the groomed Goal / Acceptance criteria / Out of scope / Constraints with every
  criterion ticked, the Engineer's summary comment, and a `## QA: PASS` comment
  with a verdict for each criterion. Resolved by
  [PR #43](https://github.com/Nalyvaiko/shared-household-chores/pull/43).
- [Issue #15 — Chore list views](https://github.com/Nalyvaiko/shared-household-chores/issues/15):
  a full cycle of Engineer summary → `## QA: FAIL` → Engineer fix comment →
  `## QA: PASS`. The fix landed in
  [PR #42](https://github.com/Nalyvaiko/shared-household-chores/pull/42)
  (`Resolves #15`).
- [Merged pull requests](https://github.com/Nalyvaiko/shared-household-chores/pulls?q=is%3Apr+is%3Amerged):
  each task PR from #22 to #52 names the issue it resolves.

Later small improvements (PRs #53 onward) were made directly as pull requests,
without a task issue.

## Getting started

### Quick start

With Node.js 24+, npm 11+ and Docker Desktop running:

```bash
npm install
npm run dev:all
```

Then open <http://localhost:3000> and sign in as a seeded demo user (see
[Seed demo data](#4-seed-demo-data)) or sign up for a new account.

`npm run dev:all` ([`scripts/dev-all.mjs`](scripts/dev-all.mjs)) does every
local step in order and stops at the first one that fails:

1. starts the Postgres from [`docker-compose.yml`](docker-compose.yml) and waits
   until its healthcheck passes (`docker compose up -d --wait db`);
2. applies the committed migrations (`prisma migrate deploy` — never resets or
   drops data);
3. seeds the demo data, only if the database has not been seeded yet;
4. starts the dev server (`next dev`; extra arguments go to it, e.g.
   `npm run dev:all -- --port 3001`).

If there is no `.env`, it runs with the local defaults from `.env.example`
(the Compose database, `AUTH_URL=http://localhost:3000`, `AUTH_TRUST_HOST=true`
and a dev-only `AUTH_SECRET`) without writing a `.env`; with a `.env` it uses
that. Variables set in your shell always win. Set `CHORES_DB_PORT` to publish
Postgres on another host port and `COMPOSE_PROJECT_NAME` to run a separate
database (its own container and volume). Running it again keeps your data.

The manual steps below are still there when you want them. To run the
production build and the database entirely in Docker instead, see
[Run with Docker](#run-with-docker).

### Requirements

- Node.js 24+
- npm 11+
- Docker (for the local Postgres)

### Install

```bash
npm install
```

### Run the dev server

```bash
npm run dev
```

Then open <http://localhost:3000>.

## Run with Docker

The whole system — PostgreSQL and the app's production build — runs in Docker
Compose with one command. You need only Docker (no Node.js, no `.env`):

```bash
docker compose up -d --build --wait   # or: npm run docker:up
```

Then open <http://localhost:3000> and sign in as a demo user (below) or sign up.

What it does:

1. builds the app image from the [`Dockerfile`](Dockerfile) (Node 24 on Debian
   slim, `npm ci`, `prisma generate`, `next build` with standalone output; the
   server runs as the non-root `node` user);
2. starts the `db` service (Postgres 16, data in the `chores-db` volume) and
   waits until it is healthy;
3. starts the `app` service, whose entrypoint
   ([`docker/entrypoint.mjs`](docker/entrypoint.mjs)) applies the committed
   migrations (`prisma migrate deploy`), seeds the demo data only if the
   database has none yet (`--skip-if-seeded`), then starts the server on port
   3000. If a step fails, the container stops with a message naming it;
4. `--wait` returns once both services are healthy (the app's healthcheck asks
   for `/signin`).

Demo users from the seed:

| Role   | Email               | Password           |
| ------ | ------------------- | ------------------ |
| Admin  | `admin@example.com` | `sparkle-otter-42` |
| Member | `member@example.com`| `maple-badger-77`  |

Stop, reset, logs:

```bash
docker compose down                # stop (or: npm run docker:down); data is kept
docker compose down -v             # stop and delete the database volume
docker compose logs -f app         # follow the app's logs
```

Restarting keeps your data and never re-seeds a database that already has the
demo household.

Configuration, all optional, read from your shell (`.env` is not needed —
[`docker-compose.yml`](docker-compose.yml) sets everything the app needs):

- `APP_PORT` — host port for the app (default 3000). `npm run dev` also uses
  3000, so stop one or set `APP_PORT=3001` to run both. `AUTH_URL` follows it.
- `CHORES_DB_PORT` — host port for Postgres (default 5432).
- `AUTH_SECRET` — the Compose file has a public, local-only default; set your
  own (e.g. `openssl rand -base64 33`) for anything beyond your machine.

The app container uses the same `db` service (and volume) as
`npm run dev:all`, so both see the same data. Use `COMPOSE_PROJECT_NAME` (or
`docker compose -p NAME`) for a fully separate stack.

## Database

The app uses PostgreSQL through [Prisma](https://www.prisma.io). The schema is
in [`prisma/schema.prisma`](prisma/schema.prisma) and the committed migrations
are in `prisma/migrations/`.

### 1. Configure `DATABASE_URL` and `DIRECT_URL`

```bash
cp .env.example .env
```

`.env` is git-ignored. Prisma reads two connection strings: `DATABASE_URL`
(runtime, pooled on hosted Postgres) and `DIRECT_URL` (direct connection for
migrations). `AUTH_SECRET` and `AUTH_URL` are covered in
[Environment variables](#environment-variables).

- **Local (Docker):** the default values in `.env.example` match the bundled
  Compose stack; `DIRECT_URL` equals `DATABASE_URL` because there is no pooler.
- **Already have a `.env`?** Add `DIRECT_URL` to it, set to the same value as
  your `DATABASE_URL`. Without it `npm run db:migrate`, `npm run db:reset` and
  `npm run db:seed` fail with `Environment variable not found: DIRECT_URL`.
- **Hosted (Neon / Supabase / Railway):** use the connection string the provider
  gives you. It has the shape
  `postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require` — most hosted
  providers require `sslmode=require`.

### 2. Run Postgres locally

A [`docker-compose.yml`](docker-compose.yml) with Postgres 16 is committed:

```bash
docker compose up -d --wait db  # start, wait until healthy (user/password/db all "chores", port 5432)
docker compose down             # stop; add -v to also drop the data volume
```

The `db` service has a `pg_isready` healthcheck, and `CHORES_DB_PORT` changes its
host port (default 5432).

If you already run Postgres another way, point `DATABASE_URL` and `DIRECT_URL`
at it instead (both the same connection string) and create an empty `chores`
database.

### 3. Apply migrations

```bash
npm run db:migrate        # prisma migrate dev — create/apply migrations in development
npm run db:reset          # prisma migrate reset — drop, recreate, re-apply
npm run db:studio         # prisma studio — browse data at http://localhost:5555
```

For non-development environments, `npx prisma migrate deploy` applies the
committed migrations without generating new ones. On Vercel it runs
automatically on every deployment (see [Deploy to Vercel](#deploy-to-vercel)).

`prisma generate` runs automatically on `npm install` (via `postinstall`), so the
`@prisma/client` types exist for `typecheck` and CI.

### 4. Seed demo data

```bash
npm run db:seed          # prisma db seed — built-in categories + a demo household
```

This populates the database with the built-in category set and one demo
household whose chores cover every state the app screens need (upcoming,
overdue, completed, skipped, recurring, claim-mode, and fixed assignment). It is
idempotent: re-running it changes nothing and exits 0. `npm run dev:all` runs it
only on a database that has no demo data yet (`--skip-if-seeded`), so starting
the app never puts demo rows you have changed back to their seeded values.
Otherwise run it by hand after migrations when you want demo data.
`npm run db:reset` also runs it once as part of recreating the database.

The seed creates two demo users you can sign in as:

| Role   | Email               | Password           |
| ------ | ------------------- | ------------------ |
| Admin  | `admin@example.com` | `sparkle-otter-42` |
| Member | `member@example.com`| `maple-badger-77`  |

### Shadow database

`prisma migrate dev` needs a second, temporary "shadow" database to detect schema
drift. The Docker/local setup above already covers this: the `chores` user can
create databases, so Prisma manages the shadow database itself and no extra
config is needed. On a hosted provider where the user **cannot** create
databases, provision a second empty database and set `shadowDatabaseUrl` in the
`datasource` block of `prisma/schema.prisma` (backed by its own env var).
`migrate deploy` never uses a shadow database.

## Scripts

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev:all`   | Start Postgres, apply migrations, seed if empty, then start the dev server — see [Quick start](#quick-start) |
| `npm run dev`       | Start the Next.js dev server on <http://localhost:3000> |
| `npm run build`     | Production build                                        |
| `npm run vercel-build` | The Vercel build command: map the Neon variables, check the required ones, apply migrations (`prisma migrate deploy`), then build — see [Deploy to Vercel](#deploy-to-vercel) |
| `npm start`         | Serve the production build                              |
| `npm run docker:up` | Build and start Postgres + the app in Docker Compose, wait until healthy — see [Run with Docker](#run-with-docker) |
| `npm run docker:down` | Stop the Compose stack (data is kept)                 |
| `npm test`          | Run the unit tests once (Vitest; the database is mocked) |
| `npm run test:unit` | Same as `npm test`                                      |
| `npm run test:watch`| Run the unit tests in watch mode                        |
| `npm run test:integration` | Run the integration tests against a real, migrated `chores_test` database |
| `npm run test:e2e`  | Build, start on port 3100, and run the Playwright smoke tests (needs a migrated database) |
| `npm run test:e2e:remote` | Run the same Playwright specs against a deployed app at `E2E_BASE_URL` (required); no local server — see [Verify the deployment](#5-verify-the-deployment) |
| `npm run test:all`  | Start the Compose Postgres, create and migrate `chores_test`, then run unit, integration and end-to-end tests — see [Tests](#tests) |
| `npm run lint`      | Lint with ESLint                                        |
| `npm run typecheck` | Generate route types and run `tsc --noEmit`             |
| `npm run db:migrate`| Create and apply migrations in development              |
| `npm run db:reset`  | Drop, recreate, and re-apply all migrations            |
| `npm run db:seed`   | Load built-in categories and a demo household (idempotent) |
| `npm run db:studio` | Open Prisma Studio to browse the database              |

## Tests

Three layers; [`_docs/testing.md`](_docs/testing.md) has what each proves and
the conventions.

- **Unit** ([Vitest](https://vitest.dev), `*.test.ts` / `*.test.tsx` in
  `tests/` or next to the code): logic with the session and database mocked.
  `npm test` (or `npm run test:unit`).
- **Integration** (Vitest, `integration/*.int.test.ts`): the real Server
  Actions and Prisma client against a real PostgreSQL database named
  `chores_test` — roll-over, cascades, and the locks under parallel requests.
  `npm run test:integration`.
- **End-to-end** (Playwright, `e2e/`): the production build in Chromium.
  `npm run test:e2e`.

Run all three with one command (Docker must be running):

```bash
npx playwright install chromium   # once per Playwright version
npm run test:all
```

[`scripts/test-all.mjs`](scripts/test-all.mjs) starts the Compose Postgres and
waits until it is healthy, creates the `chores_test` database on it if missing,
applies the migrations to it, then runs unit → integration → end-to-end, all
against `chores_test`, and stops at the first failure with its exit code. Your
development database (`chores`) is not touched and `.env` is never written.
`CHORES_DB_PORT` and `COMPOSE_PROJECT_NAME` work as for `npm run dev:all`.

End-to-end smoke tests use [Playwright](https://playwright.dev) (Chromium) and
live in `e2e/`. They are how end-to-end behaviour is proven: in CI they drive
the real app in a browser against a real, migrated PostgreSQL — sign up, create a
household, create a chore and complete it; generate an invite and join through
it. Every step goes through the app's Server Actions and is stored with Prisma in
PostgreSQL, so data persists across requests and pages. They run against a production build and a real database; to run
them on their own, start and migrate the Docker Postgres first:

```bash
docker compose up -d --wait db
npx prisma migrate deploy
npx playwright install chromium   # once per Playwright version
npm run test:e2e                  # builds, serves on :3100, runs the specs
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request. It starts a
Postgres 16 service, applies the committed migrations (`prisma migrate deploy`),
and fails if `prisma/schema.prisma` has changes with no migration
(`prisma migrate diff --exit-code`). Then it runs lint, typecheck, the unit tests, the
integration tests (against the service database), and `npm run build` (not `vercel-build`), then the Playwright end-to-end tests
against that build (the report is uploaded as an artifact when they fail). The
seed never runs in that job.

A second job, `docker`, checks the containerized system: it runs
`docker compose up -d --build --wait` (image build, migrations, seed, server),
expects `GET /signin` to return 200 and the demo household to exist in the
database, prints the Compose logs if anything fails, and removes the stack with
`docker compose down -v`.

## Environment variables

All of them are documented in [`.env.example`](.env.example). On Vercel with
the Neon integration you only add `AUTH_SECRET` yourself — see
[Deploy to Vercel](#deploy-to-vercel).

| Variable          | Local value (`.env`)                    | Production (Vercel + Neon) |
| ----------------- | --------------------------------------- | ------------------- |
| `DATABASE_URL`    | Docker Postgres URL                     | **Pooled** connection string, used by the app at runtime. Set by the Neon integration. |
| `DIRECT_URL`      | Same as `DATABASE_URL`                  | **Direct** (non-pooled) connection string, used by `prisma migrate deploy`. Not needed with Neon: the build uses the integration's `DATABASE_URL_UNPOOLED`. |
| `AUTH_SECRET`     | Any generated secret                    | **Required.** A new secret for production (`npx auth secret` or `openssl rand -base64 33`) |
| `AUTH_URL`        | `http://localhost:3000`                 | Leave unset. On Vercel, Auth.js takes the origin from the request. |
| `AUTH_TRUST_HOST` | Unset (only for `npm run build && npm start`) | Leave unset. Auth.js trusts the host by itself when Vercel's `VERCEL` variable is set. |

The build ([`scripts/vercel-build.mjs`](scripts/vercel-build.mjs)) and the app
accept the names the Neon integration sets, so nothing has to be renamed:

| Prisma reads    | Taken from the first one that is set |
| --------------- | ------------------------------------ |
| `DATABASE_URL`  | `DATABASE_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL` |
| `DIRECT_URL`    | `DIRECT_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING` (build only) |

At runtime the app connects only through the pooled URL; `DIRECT_URL` is read
only by the Prisma CLI.

If you do set `AUTH_URL` (for example on a non-Vercel host), it must match the
origin users actually open: Auth.js then builds its callback and redirect URLs,
and the app its invite links, from it, so a mismatch breaks sign-in. On Vercel
a fixed `AUTH_URL` would also send preview deployments to that origin.

## Deploy to Vercel

The recommended path is free: **Vercel Hobby** for the app and **Neon** (free
plan) for PostgreSQL, added through the Vercel Marketplace so its connection
strings land in the Vercel project automatically. The only variable you set by
hand is `AUTH_SECRET`.

**How the build works.** On install, `postinstall` runs `prisma generate`.
Vercel's Next.js preset then runs `npm run vercel-build` when that script exists
(otherwise `npm run build`). `vercel-build` runs
[`scripts/vercel-build.mjs`](scripts/vercel-build.mjs), which:

1. maps the Neon integration's variables to the names Prisma reads
   (`DATABASE_URL_UNPOOLED` → `DIRECT_URL`, and the legacy `POSTGRES_*` names;
   see [Environment variables](#environment-variables)) and prints which name
   each one came from;
2. stops with one line naming every missing variable (the database URLs and
   `AUTH_SECRET`);
3. runs `prisma migrate deploy`, then `next build`, and stops at the first
   failure with its exit code.

So the committed migrations are applied on every deployment, before the build,
and a failed migration fails the deployment. The seed is **not** part of the
build and never runs automatically.

### 1. Import the repository

In Vercel, **Add New → Project**, import the GitHub repository. Keep the
detected **Next.js** framework preset and leave the Build Command at its
default (do not override it to `next build`, or migrations are skipped).

Under **Environment Variables** on the same screen add `AUTH_SECRET` — a new
secret (`npx auth secret` or `openssl rand -base64 33`) — for all
environments. Do not add `AUTH_URL` or `AUTH_TRUST_HOST`: on Vercel, Auth.js
trusts the host because `VERCEL` is set and builds its URLs from the request
(`@auth/core` `setEnvDefaults` / `createActionURL`); invite links use the same
request origin.

Click **Deploy**. This first build fails with
`Missing required environment variable(s): DATABASE_URL …` because there is no
database yet — expected.

### 2. Add Neon from the Vercel Marketplace

In the project, **Storage → Create Database → Neon**, pick the free plan and a
region close to the app's functions (Vercel's default is Washington, D.C.,
`iad1`, so AWS `us-east-1`), and connect it to the project. Do **not** set a
custom environment variable prefix: the build looks for the default names
(`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_*`).

Connect it to **Production**, and to **Preview** only with Neon's database
branch per preview deployment turned on. Every build runs
`prisma migrate deploy`, so a preview build sharing the production database
would migrate production from an unmerged branch. Without preview branching,
leave Preview unconnected.

**Preview deployments are off.** [`vercel.json`](vercel.json) sets
`git.deploymentEnabled` to `{ "main": true, "**": false }`, so Vercel deploys
only `main` (production); every other branch is tested by CI against a real
PostgreSQL instead of failing a preview build at the missing-variable check.
To turn previews on later, enable Neon's database branch per preview
deployment, connect Neon and `AUTH_SECRET` to **Preview**, then remove the
`"**"` rule (Vercel matches branches with minimatch, where `*` stops at `/`, so
`"**"` is what covers `feat/…` branches).

### 3. Redeploy

**Deployments → … → Redeploy** (or push to `main`). The build log shows
`DATABASE_URL from DATABASE_URL`, `DIRECT_URL from DATABASE_URL_UNPOOLED`, then
`prisma migrate deploy` applying the migrations, then `next build`. Nothing
else is needed for migrations.

### 4. Optionally seed the demo household once

The seed loads the built-in categories and a demo household with the demo users
listed under [Live demo](#live-demo). Run it at most once, by hand, only if you
want demo data in production (it is idempotent, but the demo passwords are
public in this README). With the [Vercel CLI](https://vercel.com/docs/cli),
from the repository root:

```bash
npx vercel link                                             # once: pick the project
npx vercel env pull .env.vercel --environment=production    # git-ignored (.env*)
set -a; . ./.env.vercel; set +a
DATABASE_URL="$DATABASE_URL_UNPOOLED" DIRECT_URL="$DATABASE_URL_UNPOOLED" npm run db:seed
rm .env.vercel
```

The seed runs over the direct (unpooled) connection. The same variables work
for `npx prisma migrate deploy` by hand, for example to check migrations before
a deploy.

### 5. Verify the deployment

Run the Playwright specs against the live app (no local server or database is
started):

```bash
npx playwright install chromium   # once per Playwright version
E2E_BASE_URL=https://your-app.vercel.app npm run test:e2e:remote
```

They sign up, create a household, create and complete a chore, and join through
an invite link — which also proves `AUTH_SECRET`, the database and the
migrations are right. The specs only create their own users (unique
`e2e-…@example.com` emails) and households and never touch existing data, so
they are safe against production; the rows they create stay there.

Or check by hand, in order:

1. Sign up at `/signup` with a new email and password — you land signed in.
2. Create a household at `/household/new`.
3. Create a chore at `/chores/new`.
4. Complete the chore on `/chores` — it shows as completed.

Then put the URL in [Live demo](#live-demo) and fill in the record below.

### Other Postgres hosts

Any hosted PostgreSQL works if you set the variables yourself: `DATABASE_URL`
(pooled) and `DIRECT_URL` (direct). On **Supabase** use the transaction pooler
(port `6543`, append `&pgbouncer=true`) for `DATABASE_URL` and the session /
direct string (port `5432`) for `DIRECT_URL`; on **Railway** use its single
connection string for both. Keep `sslmode=require` if the provider includes it.

### Deployment verification record

One-time end-to-end check of the deployed environment. Fill in after the first
production deploy.

- Date:
- Deployed URL:
- Commit:

| Step                | Result (✓ / ✗) | Notes |
| ------------------- | -------------- | ----- |
| Sign up             |                |       |
| Create household    |                |       |
| Create chore        |                |       |
| Complete chore      |                |       |
