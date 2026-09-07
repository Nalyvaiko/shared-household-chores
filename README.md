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

## Tests

Tests use [Vitest](https://vitest.dev). Test files are named `*.test.ts` /
`*.test.tsx` and can live in `tests/` or next to the code they cover. Run them
with `npm test`. See [`_docs/testing.md`](_docs/testing.md) for conventions.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, tests, and the build on every
push and pull request.
