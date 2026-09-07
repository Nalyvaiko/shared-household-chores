# Shared Household Chores — MVP Backlog

Scope and decisions live in [`plan.md`](plan.md). Stack: Next.js (App
Router) + Server Actions, PostgreSQL, Prisma, Auth.js v5 Credentials + bcrypt,
Tailwind + shadcn/ui, deployed on Vercel.

Each task below is written to be picked up on its own: it assumes only `_docs/plan.md`
and the current repo state, not the other tasks. The numbering is a suggested order,
not a hard dependency chain. Aim for one task per working session.

---

## 1. Scaffold Next.js project with a passing test and CI
Goal: An empty but runnable Next.js app with tests and a green CI pipeline.
Description: Create a Next.js App Router project (TypeScript, ESLint) at the repo root, add Vitest with one trivial passing test, and expose `test`, `lint`, `typecheck`, and `build` scripts. Add a GitHub Actions workflow that installs dependencies and runs lint, typecheck, and tests on every push and pull request, with the package store cached. Document install, dev server, and test commands in the README.

## 2. Styling and app shell
Goal: Tailwind and shadcn/ui are installed and the app renders a consistent shell.
Description: Add Tailwind CSS and initialise shadcn/ui with a neutral theme. Build a root layout with a header (app name, placeholder for the signed-in user menu) and a centered main content container. Replace the default starter page with a simple "Chores" placeholder screen that uses the shell.

## 3. Database and Prisma setup
Goal: The app can connect to a local PostgreSQL database through Prisma.
Description: Add Prisma with a PostgreSQL datasource, a singleton Prisma client module, and a `DATABASE_URL` entry in `.env.example`. Provide `db:migrate`, `db:reset`, and `db:studio` scripts, and document running Postgres locally (Docker Compose file or a documented connection string). Include an empty initial migration so `prisma migrate deploy` works on a fresh database.

## 4. Domain schema
Goal: A Prisma schema covering the full MVP data model, with a migration.
Description: Model `User`, `Household`, `Membership` (user–household join with a `role` of `admin` or `member`), `Category` (household-scoped, with a `builtIn` flag), `Chore` (title, optional `dueAt`, priority, effort, status of `pending`/`completed`/`skipped`, recurrence frequency of none/daily/weekly/monthly, assignment mode of fixed/claim), `ChoreAssignee`, `CompletionRecord` (chore, user, `completedAt`), `SkipRecord` (chore, user, reason, `skippedAt`), and `InviteToken` (household, token, `expiresAt`, `consumedAt`). Add sensible indexes and foreign keys and generate the migration. Do not write any application logic against it yet.

## 5. Seed and fixtures
Goal: A one-command seed that creates built-in categories and a usable demo household.
Description: Write a Prisma seed script that inserts the built-in category set (e.g. Kitchen, Bathroom, Cleaning, Laundry, Outdoor, Pets, Admin), and a demo household with two users, a few chores in varied states, and one recurring chore. Wire it to `npm run db:seed` and make it idempotent. Document how to run it.

## 6. Authentication setup and sign up
Goal: New users can create an account with email and password.
Description: Configure Auth.js v5 with a Credentials provider backed by the `User` table, bcrypt password hashing, and JWT sessions. Build the `/signup` page and Server Action with server-side validation (email format, password length, duplicate email) and error display. Signing up creates the user and starts an authenticated session.

## 7. Sign in, sign out, and user menu
Goal: Existing users can sign in and out, and the header reflects auth state.
Description: Build the `/signin` page and action that authenticates against the Credentials provider and shows a clear error on bad credentials. Add a header user menu showing the signed-in user's email with a sign-out action, and sign in / sign up links when signed out. Redirect already-signed-in users away from the auth pages.

## 8. Server-side authorization helpers
Goal: Reusable guards for Server Actions and pages.
Description: Add helpers such as `requireUser()`, `requireHousehold()` (the caller's single household plus their membership), and `requireAdmin()` that throw or redirect when the condition is not met. Cover them with unit tests using a mocked session and database. These are the standard entry point for every mutation in later tasks.

## 9. Household creation
Goal: A signed-in user with no household can create one and becomes its admin.
Description: Build a "Create household" page and Server Action that creates the `Household`, creates a `Membership` with role `admin` for the current user, and copies the built-in categories into that household. Enforce the one-household-per-user rule by redirecting users who already belong to a household. After creation, redirect to the chores screen.

## 10. Members and invites page
Goal: An admin page to see household members and produce an invite link.
Description: Build a page listing every membership in the caller's household with name, email, and role. Give admins an action that creates an `InviteToken` with a random opaque token and an expiry (e.g. 7 days) and shows the copyable invite URL, a way to regenerate it, and an action to remove a member (never the last admin or themselves). Non-admins can view the member list but not the invite or removal controls.

## 11. Invite acceptance
Goal: Opening a valid invite link adds the visitor to the household.
Description: Add an `/invite/[token]` route that validates the token is known, unexpired, and unconsumed. A signed-in user without a household gets a new `member` membership and the token is marked consumed; a signed-out visitor is routed to sign up or sign in and returned to the link afterward. Show distinct messaging for expired, consumed, unknown, and already-in-a-household cases.

## 12. Category management
Goal: A household can view its categories and add or remove custom ones.
Description: Build a categories page that lists the household's categories, marking built-in ones as non-deletable. Add Server Actions to create a custom category (unique name within the household) and delete a custom category, clearing that category on any chores that referenced it. Any member may manage categories.

## 13. Create a chore — core fields
Goal: A member can create a basic chore from a form.
Description: Build the `/chores/new` form with title, optional due date and time, priority (Low/Medium/High/Urgent), effort (Small/Medium/Large), and category chosen from the household's categories. The Server Action validates input and creates a `pending` `Chore` with assignment mode defaulting to fixed and no assignees, then redirects to the chore list. Recurrence and assignment options are added by a separate task.

## 14. Chore form — recurrence and assignment
Goal: The new-chore form also captures recurrence and how the chore is assigned.
Description: Extend the `/chores/new` form and its Server Action with a recurrence frequency field (None/Daily/Weekly/Monthly), an assignment mode choice (Fixed or Claim), and, when Fixed, a multi-select of household members. Persist the recurrence value on the `Chore` and create `ChoreAssignee` rows for any selected members. Claim-mode chores are created with no assignees.

## 15. Chore list views
Goal: A shared chore list powering both the household list and the personal dashboard.
Description: Build a reusable chore list/row component showing title, category, priority, effort, due date, assignees, and status, with an "overdue" badge derived at read time (status `pending` and `dueAt` in the past). Use it for a household-wide list with filters (status, overdue only, category) sorted by due date with undated chores last, and for the post-sign-in dashboard that shows only chores the current user is assigned to or has claimed and that are still `pending`, overdue first. The dashboard is the default landing route and links through to the full household list.

## 16. Complete a chore
Goal: An assignee can mark a chore complete, and it is recorded.
Description: Add a "Complete" action available to any assignee of a chore (or any member for a claim chore they hold). It sets the chore status to `completed` and writes a `CompletionRecord` with the user and timestamp inside one transaction. For multi-assignee chores, one person completing it completes the whole chore.

## 17. Recurring chore roll-over
Goal: Completing a recurring chore creates its next occurrence.
Description: Extend the completion transaction so that when the completed chore has a recurrence frequency other than none, a new `pending` chore is created with the same title, priority, effort, category, assignment mode, assignees, and recurrence, and a `dueAt` advanced by one day, week, or month from the previous due date (or from completion time if it had none). The original chore stays `completed`. Add tests for each frequency and for the no-due-date case.

## 18. Skip a chore
Goal: A chore can be skipped with a required reason.
Description: Add a "Skip" action with a modal or form that requires a non-empty reason. The Server Action sets status to `skipped` and writes a `SkipRecord` with the user, reason, and timestamp. A skipped recurring chore does not generate a next occurrence in the MVP; note this near the control.

## 19. Claim and release claim-based chores
Goal: Members can claim an unassigned claim-mode chore and release it.
Description: For chores with assignment mode `claim` and no current assignee, show a "Claim" action that creates a `ChoreAssignee` row for the current user; when the caller is the current claimant, show "Release" to remove it. Claiming is limited to one active claimant at a time. Reflect the claim state in the list and dashboard views.

## 20. Edit and delete a chore
Goal: Chore details can be corrected, and chores can be removed.
Description: Add an edit form (same fields as creation, including recurrence and assignment) usable by any member, updating the `Chore` and its `ChoreAssignee` rows. Add a delete action restricted to admins that removes the chore and its assignee, completion, and skip records. Guard both with the authorization helpers and confirm destructive deletes in the UI.

## 21. Deployment configuration
Goal: The app can be deployed to Vercel against a hosted Postgres database.
Description: Document required environment variables (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`) in `.env.example` and the README, and add a build step that runs `prisma migrate deploy`. Verify a clean deployment path: provision a hosted Postgres instance, run migrations and the seed, and confirm sign-up through chore completion works in the deployed environment.
