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
[CI/CD](#cicd) ·
[Environment variables](#environment-variables) ·
[Deploy to Vercel](#deploy-to-vercel)

## Live demo

Live demo: <https://shared-household-chores.vercel.app> — hosted on Vercel Hobby
with a free Neon Postgres database; it is updated by the manual
[production deploy](#cicd). Every merge to `main` goes to the dev environment
first.

The demo data is not seeded in production, so sign up with any email and
password (it does not have to be real — no email is sent), create a household,
and invite others from **Members**. The maintainer can add the demo household
once by hand — see [step 4 of the deploy runbook](#4-optionally-seed-the-demo-household-once).

Anything you enter is visible to whoever signs in to the same household, so do
not use real personal data. It runs on free tiers, so the first request after a
quiet spell can take a few seconds while the database wakes up.

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
- OpenTelemetry (opt-in) for traces, metrics and logs of the key journey
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

## Observability

The key user journey, **complete a chore** (the Complete button → the
`completeChore` Server Action → the locked transaction with roll-over), is
instrumented with [OpenTelemetry](https://opentelemetry.io): traces, metrics
and structured logs that share a trace ID. It is **off by default**: with no
`OTEL_EXPORTER_OTLP_ENDPOINT` nothing is registered, exported or sent, so
tests, CI, Docker and Vercel run exactly as without it.

### What is recorded

| Signal | Name | Attributes / fields |
| --- | --- | --- |
| Trace | `chores.complete` (one per Complete click) with children `chores.complete.lock`, `chores.complete.read`, `chores.complete.write`, `chores.complete.roll_over`, plus Prisma's own spans (`prisma:client:operation`, `prisma:engine:db_query`, …) and Next.js's request spans | `chore.outcome` (`completed`, `not-pending`, `unclaimed`, `not-assignee`, `gone`, `caller-gone`, `error`), `chore.recurrence`, `chore.rolled_over`, `chore.id`; a failure sets the span's error status and `error.type` |
| Metric | `chores.completions` counter (Prometheus: `chores_completions_total`) | `chore.outcome` |
| Metric | `chores.complete.duration` histogram, ms (`chores_complete_duration_milliseconds_*`) | `chore.outcome` |
| Metric | `chores.rollovers` counter (`chores_rollovers_total`) | `chore.recurrence` |
| Log | `chore.complete.attempted`, `chore.complete.succeeded`, `chore.complete.refused`, `chore.complete.failed`, `chore.rollover.created` | `trace_id`, `span_id`, `chore.outcome`, `chore.recurrence`, `duration_ms`, `chore.id` |

Logs are JSON lines on stdout (always; `LOG_LEVEL=debug|info|warn|error|silent`,
default `info`) and, when telemetry is on, OpenTelemetry log records. Inside
the journey both carry the active span's `trace_id` and `span_id`, so a log
line leads to its trace and a trace to its log lines. The code:
[`instrumentation.ts`](instrumentation.ts), [`lib/observability/`](lib/observability).

### Privacy: no customer data or credentials

Enforced in code, not by convention
([`lib/observability/privacy.ts`](lib/observability/privacy.ts)):

- **Allow-list.** Every span attribute (ours, Next.js's and Prisma's), log
  field and metric attribute must be on a fixed list of names, and its value
  must pass that name's check (an enum value, a boolean, a cuid, a route
  pattern…). Anything else is dropped. Spans are scrubbed again in the
  exporter, so a library cannot bypass it.
- **Never sent:** passwords, session tokens and cookies, `Authorization` and
  any other HTTP headers, emails, names, chore titles, skip reasons, invite
  tokens, connection strings, query strings and query parameter values, user
  ids and household ids. Error messages and stack traces are not recorded
  (only the error's class name).
- **Ids.** The chore id is the only record id sent: an opaque random cuid that
  says nothing about a person, useful to find the row behind a refusal. User
  and household ids are omitted (not hashed: a hash of a known id can be
  matched back).
- **URLs.** `http.target` and `http.url` are dropped; span names lose any query
  string, and `/invite/<token>` becomes `/invite/[token]`.
- **SQL.** Prisma's statements are parameterized (`$1`); string and number
  literals are redacted anyway.
- **Resource.** Only `service.name` (`shared-household-chores`) and
  `deployment.environment.name` (`DEPLOYMENT_ENVIRONMENT`, else `VERCEL_ENV`,
  else `NODE_ENV`); no host or process detectors (no command line, no
  environment).
- There is no HTTP auto-instrumentation, so no headers are captured at all.

Unit tests ([`lib/observability/*.test.ts`](lib/observability)) prove the
scrubber drops these and that log lines carry the span's ids.

### Run it locally: collect, store and view

The `observability` Compose profile runs
[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm): an
OpenTelemetry Collector, Tempo (traces), Loki (logs), Prometheus (metrics) and
Grafana in one container, data kept in the `observability-data` volume. Free
and local; plain `docker compose up`, `dev:all` and `test:all` never start it.

With the dev server:

```bash
npm run observability:up        # Grafana on :3001, OTLP/HTTP on :4318, alert receiver, on-call agent
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev:all   # or npm run dev
npm run observability:down      # stop it; data is kept
```

(PowerShell: `$env:OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"` before
`npm run dev`.) Or everything in Docker, the app exporting to the collector:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://observability:4318 \
  docker compose --profile observability up -d --build --wait
docker compose --profile observability down        # add -v to delete the data
```

Complete a chore, then open <http://localhost:3001> (no login on this local
stack) → Dashboards → **shared-household-chores / Complete a chore**:
completions by outcome, p50/p95 duration, roll-overs, recent
`chores.complete` traces and the journey logs. Metrics are exported every
15 s (`OTEL_METRIC_EXPORT_INTERVAL`, ms).

- **Log → trace:** in the logs panel (or Explore → Loki,
  `{service_name="shared-household-chores"}`), expand a line and click the
  `trace_id` link.
- **Trace → logs:** open a trace (the traces table, or Explore → Tempo,
  `{name="chores.complete"}`), then on a span click **Logs for this span**.
- `OBSERVABILITY_UI_PORT` and `OTLP_HTTP_PORT` change the host ports.

### Alerts

Two Grafana alert rules watch the complete-a-chore journey for what a person
would notice. They are provisioned from
[`observability/grafana/alerting/`](observability/grafana/alerting) into the
local stack (Grafana → Alerting → Alert rules → folder **Shared household
chores**, group `complete-a-chore`, evaluated every minute):

| Alert | Fires when | Severity | What it means for users |
| --- | --- | --- | --- |
| **Chore completions failing** | At least one Complete attempt ended with outcome `error` in the last 5 min (`chores_completions_total{chore_outcome="error"}`), for 1 min | `critical` | People pressing Complete get a server error: the chore stays pending and no next occurrence is created. |
| **Chore completions slow** | p95 of `chores_complete_duration_milliseconds` over 5 min is above 2000 ms, for 5 min | `warning` | Completing a chore takes more than 2 s for many people; some click again or give up. |

Both carry `journey=complete-chore`, a summary with the current value, the
user impact, and a link back here. No traffic is not an outage: with no data a
rule stays OK. Refusals (`not-pending`, `not-assignee`, …) are expected answers
and never alert. The failing rule also counts the very first error after a
restart: a brand-new error series starts at 1, which `increase()` alone misses,
so the query adds the value of a series that is new in the window.

**Where notifications go.** The `observability` profile routes every alert
(one notification per rule, after 30 s; repeated every 4 h while firing, plus
a resolved message) to the webhook contact point `chores-alert-webhook`, which
posts to `alert-receiver`, a tiny echo service that prints each request body
(and to the [on-call agent](#on-call-agent)):

```bash
docker compose logs -f alert-receiver     # the alert JSON: status, labels, annotations, values
```

The payload holds the rule's labels, annotations, value and Grafana links only.
The metrics behind it carry no customer data (see Privacy above), so neither
does an alert. To notify people instead, edit
[`notifications.yaml`](observability/grafana/alerting/notifications.yaml):
change the receiver's `type` to `email` (`addresses`, plus `GF_SMTP_*`
variables on the `observability` service) or `slack` (`url` of an incoming
webhook), and pass secrets with `$__env{VAR}`, never as literals in the file.
Then restart the `observability` service.

#### Runbook: Chore completions failing

1. **Scope.** Dashboard **Complete a chore** → *Completions by outcome*: how
   many `error`s, since when, and whether `completed` stopped too (all down)
   or continues (some households or chores).
2. **Logs.** Explore → Loki:
   `{service_name="shared-household-chores"} | event_name="chore.complete.failed"`
   (the log's `event`; on stdout it is the JSON field `event`). Each line has
   `trace_id` and `duration_ms` (a few ms: refused connection; seconds:
   timeouts).
3. **Trace.** Click the line's `trace_id`: the failed child span
   (`chores.complete.lock`/`read`/`write`/`roll_over` or a `prisma:*` span)
   and its `error.type` (e.g. `PrismaClientKnownRequestError`,
   `PrismaClientInitializationError`). Messages and stack traces are not
   exported; for those, read the app's stdout (`docker compose logs app`,
   Vercel → Logs) around the same time.
4. **Database.** Is Postgres up and reachable? Locally
   `docker compose ps db` and `docker compose exec db pg_isready -U chores`;
   in production the Neon console (status, compute suspended, connection
   limit). A recent deploy with a pending migration also shows up here: check
   the last `prisma migrate deploy` in the deploy log.
5. **Resolve.** Once completions work again, the rule returns to Normal
   within about 5 min of the last failed attempt (the query window), and the
   receiver gets a `resolved` message at the next group interval (up to 5 min
   later).

#### Runbook: Chore completions slow

1. Dashboard → *Complete duration p50 / p95 by outcome*: all outcomes slow
   (database or host) or only `completed` (lock waits or roll-over).
2. Explore → Tempo, `{name="chores.complete" && duration > 2s}`: which child
   span holds the time. A long `chores.complete.lock` means people in the same
   household completing at once; long `prisma:engine:db_query` spans mean a
   slow database (Neon cold start, CPU, connection limit).
3. Loki:
   `{service_name="shared-household-chores"} | event_name="chore.complete.succeeded" | duration_ms > 2000`
   for the slow attempts and their `trace_id`s.

#### Silence an alert

Grafana → Alerting → Silences → **New silence**, matcher
`alertname = Chore completions failing` (or `journey = complete-chore` for
both), with a duration and a comment, e.g. during planned database
maintenance. The rule keeps evaluating; only notifications stop. Provisioned
rules cannot be edited in the UI: change the YAML and restart the
`observability` service.

#### Production

Not configured by this project. With telemetry sent to Grafana Cloud (see
below), create the same two rules there (Alerting → Alert rules, free tier
included) on the Grafana Cloud Prometheus datasource, copying the queries,
thresholds, `for` and labels from
[`alert-rules.yaml`](observability/grafana/alerting/alert-rules.yaml), and
point the default contact point at email or Slack. Any other OTLP backend
needs its own alert on the same two series.

### On-call agent

`oncall-agent` (profile `observability`) is the first responder for the alerts
above: Grafana wakes it, it diagnoses the local stack, applies a known fix from
a short allow-list, checks that the fix worked and writes an incident report.
It is rule-based and deterministic (fixed playbooks, no model, no external
service) and runs from the stock `node:24-slim` image with
[`oncall/`](oncall) bind-mounted: no build, no dependencies.

**How it wakes.** The contact point `chores-alert-webhook` has a second
webhook integration, `http://oncall-agent:8080/alerts`, with
`Authorization: Bearer $ONCALL_AGENT_TOKEN` (the same variable on the
`observability` and `oncall-agent` services; the default is a public,
local-only value). Requests without that token get `401`. A resolved
notification, or a firing alert with no playbook, is logged and answered
`204`; a firing alert with a playbook is answered `202` and handled in the
background, one incident per playbook at a time.

#### Playbooks

[`oncall/playbooks.mjs`](oncall/playbooks.mjs), matched by `alertname` and
`journey=complete-chore`:

| Alert | Diagnosis | Action (allow-list only) | Verification |
| --- | --- | --- | --- |
| **Chore completions failing** | State and health of every container in its own Compose project; TCP connect to `db:5432`; `GET /signin` on the app; Loki: count and `trace_id`s of `chore.complete.failed` in the last 15 min | `db` not running → **start** `db`. `db` unhealthy → **restart** `db`. `db` healthy and `app` not running → **start** `app`; `app` unhealthy → **restart** `app`. Anything else (db starting, port closed while running, everything healthy) → no action, **needs a human** | `db` healthy, `/signin` answers 200, then the Grafana rule back to Normal (polled every 15 s, up to 15 min) |
| **Chore completions slow** | Same diagnosis | None: always **needs a human** (see the runbook above) | — |

The fix for a stopped database is the same as the manual one in the runbook
(`docker compose start db`); the agent only does it sooner. Expect the alert
to fire about 1.5–2.5 min after the first failed Complete (1 min evaluation +
1 min `for` + 30 s group wait), the agent to start the database within
seconds of that, and the rule to return to Normal about 5 min after the last
failed Complete (the query window).

#### Guardrails

- **Allow-list.** The only Docker calls it makes besides reads are
  `POST /containers/{id}/start` and `/restart`, for the `db` and `app`
  services. It never stops, removes or recreates a container, and never
  touches volumes, images or data.
- **Own project only.** It reads `com.docker.compose.project` from its own
  container (or `ONCALL_COMPOSE_PROJECT`), lists containers with that label
  filter, and refuses to act if the project is unknown.
- **Rate limit.** At most `ONCALL_MAX_ACTIONS` (default 2) actions per alert
  per 10 minutes; past that it reports `rate-limited` and needs a human.
- **Dry run.** `ONCALL_DRY_RUN=1` diagnoses and reports what it would do,
  without acting (`outcome: "dry-run"`).
- **No customer data.** Reports hold the alert's name, rule uid, severity,
  start time and fingerprint (never annotations or values), container
  states, a status code, counts and trace ids. Log bodies are not read.

#### Incident reports

One JSON object per incident (`type: "oncall.incident"`): `incidentId`,
`alert`, `startedAt`/`endedAt`, `diagnosis`, `decision` (`act`/`escalate` and
a fixed reason), `actions` (with `executed` and `result`), `verification`,
`timeline` (`woke`, `diagnosed`, `action:start:db`, `db-healthy`,
`signin-ok`, `alert-normal`), `traceIds`, `outcome` (`remediated`,
`escalated`, `rate-limited`, `dry-run`) and `needsHuman`. Each report goes to:

```bash
docker compose logs oncall-agent | grep oncall.incident                      # stdout, one JSON line
docker compose exec oncall-agent cat /var/lib/oncall/incidents.jsonl          # volume oncall-incidents
docker compose logs alert-receiver | grep oncall-incidents                     # posted for visibility
```

and to Loki as an OpenTelemetry log record (Explore → Loki,
`{service_name="oncall-agent"}`); its `traceIds` open the failed completions
in Tempo.

Try it without waiting for a real outage: `ONCALL_DRY_RUN=1` on the
`docker compose ... up` command, stop the database
(`docker compose stop db`), complete a chore, and read the report; then
`docker compose start db`.

#### Add a playbook

Add an entry to `PLAYBOOKS` in [`oncall/playbooks.mjs`](oncall/playbooks.mjs)
with the labels it matches, the Grafana rule uid to verify against, and a pure
`decide(facts)` that returns `act` with allow-listed actions or `escalate`.
A new kind of action also needs an `ALLOWED_ACTIONS` entry and its Docker call
in [`oncall/agent.mjs`](oncall/agent.mjs). Cover the decision in
[`tests/oncall-agent.test.ts`](tests/oncall-agent.test.ts).

#### Security and production

The agent mounts `/var/run/docker.sock`, which is control of the whole Docker
engine: `:ro` only protects the socket file, not the API. That is acceptable
for this local, single-user stack only, where the agent is not published on
the host and its own code limits what it does. In production, do not give a
responder a Docker socket: call the platform's scoped API instead, e.g. a
Vercel deploy hook (redeploy) or the Neon API (restart or resume the compute)
with a token limited to that project, kept in a secret store, with the same
allow-list, rate limit, dry-run switch and report. Set a real
`ONCALL_AGENT_TOKEN` (`openssl rand -base64 33`) on both services for
anything beyond your machine. With `npm run dev` (app on the host), set
`ONCALL_APP_URL=http://host.docker.internal:3000`.

### Production: a hosted OTLP backend

Not configured by this project. Any OTLP/HTTP backend works by setting the
standard variables in the deployment (e.g. Vercel → Settings → Environment
Variables); for the Grafana Cloud free tier, the values come from its
**OpenTelemetry (OTLP)** connection page:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 of instanceId:token>
DEPLOYMENT_ENVIRONMENT=production   # optional; defaults to VERCEL_ENV
```

Unset `OTEL_EXPORTER_OTLP_ENDPOINT` to turn it off again. Telemetry is batched
(spans and logs every few seconds, metrics every 15 s); a serverless instance
that is frozen right after a request can lose its last batch.

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
| `npm run observability:up` | Start the local observability stack (Collector, Tempo, Loki, Prometheus, Grafana on :3001, alert receiver, on-call agent) — see [Observability](#observability) |
| `npm run observability:down` | Stop the observability stack (data is kept)    |
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

## CI/CD

```text
push / pull request ──► CI (ci.yml: lint, typecheck, unit, integration, build, e2e, docker)

merge to main ──► CI ──(green)──► Deploy to dev (deploy-dev.yml)
                                    vercel pull/build/deploy (Preview env → dev DB)
                                    alias → dev URL ──► smoke tests (Playwright)

Actions → "Deploy to production" → Run workflow (ref, default main)
   ──► check: commit is on main and CI passed on it
   ──► approval (production environment reviewer)
   ──► vercel pull/build --prod/deploy --prod (Production env → prod DB)
   ──► smoke tests against production
```

| Environment | URL | Deployed by | Vercel settings (database) |
| ----------- | --- | ----------- | -------------------------- |
| `development` | <https://shared-household-chores-dev.vercel.app> | [`deploy-dev.yml`](.github/workflows/deploy-dev.yml), automatically after CI passes on `main` | Preview environment variables (Neon `dev` branch) |
| `production` | <https://shared-household-chores.vercel.app> | [`deploy-production.yml`](.github/workflows/deploy-production.yml), by hand, after approval | Production environment variables (Neon main branch) |

Vercel no longer deploys from Git pushes: [`vercel.json`](vercel.json) sets
`git.deploymentEnabled` to `false`, and GitHub Actions deploys with the Vercel
CLI instead (`vercel pull`, `vercel build`, `vercel deploy --prebuilt`), as in
Vercel's [GitHub Actions guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).
`vercel build` runs `npm run vercel-build` on the runner, so each deploy applies
the committed migrations (`prisma migrate deploy`) to **its own environment's
database** before `next build`. Neither workflow seeds. A dev deploy is a Vercel
preview deployment pointed at the fixed dev URL with `vercel alias set`; a
production deploy (`--prod`) gets the production domain. Each environment has
its own concurrency group, so deploys never overlap and are never cancelled
mid-migration. Both fail in the first step, naming the missing secret, until
the setup below is done.

### Run a production deploy

1. **Actions → Deploy to production → Run workflow**. Keep "Use workflow from"
   on `main`; set `ref` to a commit SHA or tag on `main` to deploy (or roll back
   to) an older commit, or leave `main`.
2. The `check` job stops the run if that commit is not on `main` or has no
   green CI run.
3. The run then waits on the `production` environment: open it and
   **Review deployments → Approve and deploy**.
4. It builds, deploys, and runs the smoke tests against production. They only
   create their own `e2e-…@example.com` users and households.

### One-time setup (maintainer)

GitHub environments `development` and `production` exist already (Settings →
Environments): both accept deployments only from `main`, and `production`
requires approval by the repository owner (`Nalyvaiko`).

1. **Vercel token and IDs.** Create a token at
   <https://vercel.com/account/tokens>. Find the IDs in the Vercel project's
   **Settings → General** (Project ID; the team/owner ID under the account's
   **Settings → General**), or run `npx vercel link` and read
   `.vercel/project.json` (`orgId`, `projectId`). In GitHub, **Settings →
   Secrets and variables → Actions → New repository secret**: `VERCEL_TOKEN`,
   `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
2. **Dev database.** In Neon, create a branch named `dev` from the production
   branch (or empty). In Vercel, **Settings → Environment Variables**, add for
   **Preview** only: `DATABASE_URL` (the `dev` branch's pooled connection
   string), `DATABASE_URL_UNPOOLED` (its direct string) and a new
   `AUTH_SECRET` (not the production one). Keep Neon's Production variables as
   they are.
3. **Config, not Secret.** `vercel pull` writes the variables to the runner for
   `vercel build`; a Vercel variable of type *Secret* (formerly *Sensitive*) is
   decryptable only inside Vercel's own builds
   ([docs](https://vercel.com/docs/environment-variables/sensitive-environment-variables)).
   If a build fails with `Missing required environment variable(s)` although
   the variable is set, recreate it as **Config** for that environment.
4. **Dev URL access.** Vercel's Standard Deployment Protection (on by default)
   puts preview deployments, and so the dev URL, behind Vercel login. For the
   smoke tests either turn it off (**Settings → Deployment Protection**) or,
   in the same place, create a **Protection Bypass for Automation** secret
   ([docs](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation))
   and add it as the GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET`; the
   smoke tests then send it as the `x-vercel-protection-bypass` header.
5. Re-run the latest **Deploy to dev** run (or merge to `main`), then run
   **Deploy to production** once to check the production path.

Until steps 1–2 are done, merges to `main` deploy nowhere: **Deploy to dev**
fails at its first step, and production changes only through a manual run.

### CI

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
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Unset (telemetry off), or `http://localhost:4318` with `npm run observability:up` | Optional. A hosted OTLP/HTTP backend turns telemetry on — see [Observability](#observability) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Unset | Optional. The backend's auth header, e.g. `Authorization=Basic%20...` |
| `LOG_LEVEL` | Unset (`info`) | Optional. Lowest level of the JSON log lines on stdout (`silent` turns them off) |

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
(otherwise `npm run build`) — in Vercel's own builds and in `vercel build` on
the GitHub Actions runner alike (see [CI/CD](#cicd); Git pushes no longer
trigger Vercel builds). `vercel-build` runs
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

Connect it to **Production** only. The **Preview** environment is the dev
environment and points at a separate Neon `dev` branch that you set by hand
([CI/CD one-time setup](#one-time-setup-maintainer), step 2). Every build runs
`prisma migrate deploy`, so Preview must never share the production database.

**Git pushes do not deploy.** [`vercel.json`](vercel.json) sets
`git.deploymentEnabled` to `false` for every branch; GitHub Actions deploys
instead — `main` to dev after CI passes, production by hand
(see [CI/CD](#cicd)). Other branches are tested by CI only.

### 3. Deploy

Do the [CI/CD one-time setup](#one-time-setup-maintainer), then run
**Actions → Deploy to production** (or **Deployments → … → Redeploy** in
Vercel). The build log shows `DATABASE_URL from DATABASE_URL`,
`DIRECT_URL from DATABASE_URL_UNPOOLED`, then `prisma migrate deploy` applying
the migrations, then `next build`. Nothing else is needed for migrations.

### 4. Optionally seed the demo household once

The seed loads the built-in categories and a demo household with the demo users
listed under [Seed demo data](#4-seed-demo-data). Run it at most once, by hand,
only if you want demo data in production (it is idempotent, but the demo
passwords are public in this README). The live demo above is not seeded. With the [Vercel CLI](https://vercel.com/docs/cli),
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

One-time end-to-end check of the deployed environment, after the first
production deploy.

- Date: 2026-11-14
- Deployed URL: <https://shared-household-chores.vercel.app>
- Commit: `main` at `7c2deab` (Vercel Hobby + Neon free)
- How: `E2E_BASE_URL=https://shared-household-chores.vercel.app npm run test:e2e:remote`
  (2 passed: `chore-lifecycle.spec.ts` 5.5s, `invite.spec.ts` 8.2s), plus a manual
  check in a browser

| Step                | Result (✓ / ✗) | Notes |
| ------------------- | -------------- | ----- |
| Sign up             | ✓              | Lands on `/household/new`, signed in |
| Create household    | ✓              | Lands on the dashboard ("My chores") |
| Create chore        | ✓              | `chore-lifecycle.spec.ts` |
| Complete chore      | ✓              | Shows as completed on `/chores` |
| Invite → join       | ✓              | Invite URL uses the production origin (`https://shared-household-chores.vercel.app/invite/…`); the invitee signs up and joins as a member |
| Sign out → sign in  | ✓              | `/chores` and `/household/members` load |
| Demo accounts       | ✗              | Not seeded in production — `admin@example.com` gets "Invalid email or password." (expected; see step 4) |
