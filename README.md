# shared-household-chores

Web app for managing shared household chores for couples, families, roommates, or
any other group.

Built with Next.js (App Router) + Server Actions, PostgreSQL + Prisma, Auth.js v5,
and Tailwind + shadcn/ui. Scope and product decisions live in
[`_docs/plan.md`](_docs/plan.md); the MVP backlog is [`_docs/tasks.md`](_docs/tasks.md).

## Requirements

- Node.js 24+
- npm 11+

## Install

```bash
npm install
```

## Run the dev server

```bash
npm run dev
```

Then open <http://localhost:3000>.

## Database

The app uses PostgreSQL through [Prisma](https://www.prisma.io). There are no
domain models yet; this is just the connection wiring plus an empty initial
migration.

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
docker compose up -d      # start (user/password/db all "chores", port 5432)
docker compose down        # stop; add -v to also drop the data volume
```

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
idempotent: re-running it changes nothing and exits 0. It is never run
automatically — run it by hand after migrations when you want demo data.
`npm run db:reset` also runs it once as part of recreating the database.

The seed creates two demo users you can sign in as once auth is wired up:

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
| `npm run dev`       | Start the Next.js dev server on <http://localhost:3000> |
| `npm run build`     | Production build                                        |
| `npm run vercel-build` | Apply migrations (`prisma migrate deploy`), then build — the Vercel build command |
| `npm start`         | Serve the production build                              |
| `npm test`          | Run the Vitest suite once                               |
| `npm run test:watch`| Run Vitest in watch mode                                |
| `npm run lint`      | Lint with ESLint                                        |
| `npm run typecheck` | Generate route types and run `tsc --noEmit`             |
| `npm run db:migrate`| Create and apply migrations in development              |
| `npm run db:reset`  | Drop, recreate, and re-apply all migrations            |
| `npm run db:seed`   | Load built-in categories and a demo household (idempotent) |
| `npm run db:studio` | Open Prisma Studio to browse the database              |

## Tests

Tests use [Vitest](https://vitest.dev). Test files are named `*.test.ts` /
`*.test.tsx` and can live in `tests/` or next to the code they cover. Run them
with `npm test`. See [`_docs/testing.md`](_docs/testing.md) for conventions.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, tests, and the build on every
push and pull request. CI runs `npm run build` (not `vercel-build`), so it needs
no database and no environment variables.

## Environment variables

All of them are documented in [`.env.example`](.env.example). In production set
each one in the Vercel project (Settings → Environment Variables, Production
environment).

| Variable          | Local value (`.env`)                    | Production (Vercel) |
| ----------------- | --------------------------------------- | ------------------- |
| `DATABASE_URL`    | Docker Postgres URL                     | Hosted Postgres **pooled** connection string — used by the app at runtime |
| `DIRECT_URL`      | Same as `DATABASE_URL`                  | Hosted Postgres **direct** (non-pooled) connection string — used by `prisma migrate deploy` |
| `AUTH_SECRET`     | Any generated secret                    | A new secret for production (`npx auth secret` or `openssl rand -base64 33`) |
| `AUTH_URL`        | `http://localhost:3000`                 | The deployed origin, exactly — e.g. `https://your-app.vercel.app` (no trailing slash) |
| `AUTH_TRUST_HOST` | Unset (only for `npm run build && npm start`) | `true` |

`AUTH_URL` must match the origin users actually open: Auth.js builds its
callback and redirect URLs from it, so a mismatch breaks sign-in. If you add a
custom domain later, update `AUTH_URL` and redeploy.

## Deploy to Vercel

The app runs on Vercel against a hosted PostgreSQL database (Neon, Supabase, or
Railway).

**How the build works.** On install, `postinstall` runs `prisma generate`.
Vercel's Next.js preset then runs `npm run vercel-build` when that script exists
(otherwise `npm run build`). `vercel-build` is
`prisma migrate deploy && next build`, so the committed migrations are applied
to the production database on every deployment, before the build; a failed
migration fails the deployment. The seed is **not** part of the build and never
runs automatically.

### 1. Provision hosted Postgres

Create a PostgreSQL database on one of:

- **Neon** — copy the *pooled* connection string (host contains `-pooler`) for
  `DATABASE_URL` and the *direct* one (same host without `-pooler`) for
  `DIRECT_URL`.
- **Supabase** — Project Settings → Database: the *transaction pooler* string
  (port `6543`, append `&pgbouncer=true`) for `DATABASE_URL` and the *direct* /
  *session* string (port `5432`) for `DIRECT_URL`.
- **Railway** — a single connection string; use it for both variables.

Keep `sslmode=require` on both strings if the provider includes it.

### 2. Create the Vercel project

Import the GitHub repository in Vercel. Keep the detected **Next.js** framework
preset and leave the Build Command at its default (do not override it to
`next build`, or migrations are skipped).

### 3. Set environment variables

In the Vercel project, Settings → Environment Variables, add for **Production**:

- `DATABASE_URL` — pooled connection string
- `DIRECT_URL` — direct connection string
- `AUTH_SECRET` — a new generated secret
- `AUTH_URL` — the production origin, e.g. `https://your-app.vercel.app`
- `AUTH_TRUST_HOST` — `true`

If you do not know the final origin yet, deploy once, copy the production
domain from the Vercel dashboard into `AUTH_URL`, and redeploy.

### 4. Deploy and run migrations

Trigger a deployment (push to `main`, or Deployments → Redeploy). The build log
shows `prisma migrate deploy` applying any pending migrations, then
`next build`. Nothing else is needed for migrations.

To apply migrations by hand instead (for example to check them before a
deploy), run from your machine with the production **direct** URL:

```bash
DATABASE_URL="<direct url>" DIRECT_URL="<direct url>" npx prisma migrate deploy
```

### 5. Optionally seed once

The seed loads the built-in categories and a demo household with the demo users
listed under [Seed demo data](#4-seed-demo-data). Run it at most once, by hand,
only if you want demo data in production (it is idempotent, but the demo
passwords are public in this README):

```bash
DATABASE_URL="<direct url>" DIRECT_URL="<direct url>" npm run db:seed
```

### 6. Verify the deployment

Open the production URL and check, in order:

1. Sign up at `/signup` with a new email and password — you land signed in
   (this also confirms `AUTH_URL`, `AUTH_SECRET` and `AUTH_TRUST_HOST` are right).
2. Create a household at `/household/new`.
3. Create a chore at `/chores/new`.
4. Complete the chore on `/chores` — it shows as completed.

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
