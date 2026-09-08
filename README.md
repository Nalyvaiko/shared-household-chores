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

### 1. Configure `DATABASE_URL`

```bash
cp .env.example .env
```

`.env` is git-ignored. It needs a single variable, `DATABASE_URL`.

- **Local (Docker):** the default value in `.env.example` matches the bundled
  Compose stack.
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

If you already run Postgres another way, point `DATABASE_URL` at it instead and
create an empty `chores` database.

### 3. Apply migrations

```bash
npm run db:migrate        # prisma migrate dev — create/apply migrations in development
npm run db:reset          # prisma migrate reset — drop, recreate, re-apply
npm run db:studio         # prisma studio — browse data at http://localhost:5555
```

For non-development environments, `npx prisma migrate deploy` applies the
committed migrations without generating new ones.

`prisma generate` runs automatically on `npm install` (via `postinstall`), so the
`@prisma/client` types exist for `typecheck` and CI.

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
| `npm start`         | Serve the production build                              |
| `npm test`          | Run the Vitest suite once                               |
| `npm run test:watch`| Run Vitest in watch mode                                |
| `npm run lint`      | Lint with ESLint                                        |
| `npm run typecheck` | Generate route types and run `tsc --noEmit`             |
| `npm run db:migrate`| Create and apply migrations in development              |
| `npm run db:reset`  | Drop, recreate, and re-apply all migrations            |
| `npm run db:studio` | Open Prisma Studio to browse the database              |

## Tests

Tests use [Vitest](https://vitest.dev). Test files are named `*.test.ts` /
`*.test.tsx` and can live in `tests/` or next to the code they cover. Run them
with `npm test`. See [`_docs/testing.md`](_docs/testing.md) for conventions.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, tests, and the build on every
push and pull request.
