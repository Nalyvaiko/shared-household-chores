# Shared Household Chores — MVP Backlog

Scope and decisions live in [`plan.md`](plan.md). Stack: Next.js (App
Router) + Server Actions, PostgreSQL, Prisma, Auth.js v5 Credentials + bcrypt,
Tailwind + shadcn/ui, deployed on Vercel.

Each task below is written to be picked up on its own: it assumes only `_docs/plan.md`
and the current repo state, not the other tasks. The numbering is a suggested order,
not a hard dependency chain. Aim for one task per working session.

Per `process.md`: read a task's **Acceptance criteria** before starting and again
before closing its issue.

---

## 1. Scaffold Next.js project with a passing test and CI
Goal: An empty but runnable Next.js app with tests and a green CI pipeline.
Description: Create a Next.js App Router project (TypeScript, ESLint) at the repo root, add Vitest with one trivial passing test, and expose `test`, `lint`, `typecheck`, and `build` scripts. Add a GitHub Actions workflow that installs dependencies and runs lint, typecheck, and tests on every push and pull request, with the package store cached. Document install, dev server, and test commands in the README.
Acceptance criteria:
- `npm install` then `npm run dev` serves the app on localhost.
- `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all exist and succeed.
- At least one Vitest test file runs and passes.
- A GitHub Actions workflow runs lint, typecheck, and tests on push and pull request, and is green.
- README documents install, dev server, and test commands.

## 2. Styling and app shell
Goal: Tailwind and shadcn/ui are installed and the app renders a consistent shell.
Description: Add Tailwind CSS and initialise shadcn/ui with a neutral theme. Build a root layout with a header (app name, placeholder for the signed-in user menu) and a centered main content container. Replace the default starter page with a simple "Chores" placeholder screen that uses the shell.
Acceptance criteria:
- Tailwind utility classes take effect in the running app.
- shadcn/ui is initialised and at least one shadcn component renders.
- The root layout shows a header (app name + user-menu placeholder) and a centered main container on every route.
- The default starter page is replaced by a "Chores" placeholder built with the shell.

## 3. Database and Prisma setup
Goal: The app can connect to a local PostgreSQL database through Prisma.
Description: Add Prisma with a PostgreSQL datasource, a singleton Prisma client module, and a `DATABASE_URL` entry in `.env.example`. Provide `db:migrate`, `db:reset`, and `db:studio` scripts, and document running Postgres locally (Docker Compose file or a documented connection string). Include an empty initial migration so `prisma migrate deploy` works on a fresh database.
Acceptance criteria:
- `prisma/schema.prisma` exists with a PostgreSQL datasource.
- A singleton Prisma client module is exported and reused across imports.
- `.env.example` includes `DATABASE_URL`; `db:migrate`, `db:reset`, and `db:studio` scripts work.
- Running Postgres locally is documented (Compose file or connection string).
- `prisma migrate deploy` succeeds against an empty database.

## 4. Domain schema
Goal: A Prisma schema covering the full MVP data model, with a migration.
Description: Model `User`, `Household`, `Membership` (user–household join with a `role` of `admin` or `member`), `Category` (household-scoped, with a `builtIn` flag), `Chore` (title, optional `dueAt`, priority, effort, status of `pending`/`completed`/`skipped`, recurrence frequency of none/daily/weekly/monthly, assignment mode of fixed/claim), `ChoreAssignee`, `CompletionRecord` (chore, user, `completedAt`), `SkipRecord` (chore, user, reason, `skippedAt`), and `InviteToken` (household, token, `expiresAt`, `consumedAt`). Add sensible indexes and foreign keys and generate the migration. Do not write any application logic against it yet.
Acceptance criteria:
- Models exist for User, Household, Membership, Category, Chore, ChoreAssignee, CompletionRecord, SkipRecord, and InviteToken.
- Membership has an admin/member role; Chore has the status, recurrence-frequency, and assignment-mode enums described.
- Foreign keys and indexes are defined on join and lookup columns.
- A migration is generated and applies cleanly to an empty database.
- No application or query code is added in this task.

## 5. Seed and fixtures
Goal: A one-command seed that creates built-in categories and a usable demo household.
Description: Write a Prisma seed script that inserts the built-in category set (e.g. Kitchen, Bathroom, Cleaning, Laundry, Outdoor, Pets, Admin), and a demo household with two users, a few chores in varied states, and one recurring chore. Wire it to `npm run db:seed` and make it idempotent. Document how to run it.
Acceptance criteria:
- `npm run db:seed` inserts the built-in category set.
- The seed creates a demo household with two users and chores spanning pending, completed, and skipped, plus one recurring chore.
- Running the seed twice causes no duplicates and no errors.
- README documents how to run the seed.

## 6. Authentication setup and sign up
Goal: New users can create an account with email and password.
Description: Configure Auth.js v5 with a Credentials provider backed by the `User` table, bcrypt password hashing, and JWT sessions. Build the `/signup` page and Server Action with server-side validation (email format, password length, duplicate email) and error display. Signing up creates the user and starts an authenticated session.
Acceptance criteria:
- Auth.js v5 is configured with a Credentials provider over the `User` table, bcrypt hashing, and JWT sessions.
- `/signup` creates a user and starts an authenticated session.
- Server-side validation rejects malformed email, too-short password, and duplicate email with visible messages.
- Passwords are persisted only as bcrypt hashes.

## 7. Sign in, sign out, and user menu
Goal: Existing users can sign in and out, and the header reflects auth state.
Description: Build the `/signin` page and action that authenticates against the Credentials provider and shows a clear error on bad credentials. Add a header user menu showing the signed-in user's email with a sign-out action, and sign in / sign up links when signed out. Redirect already-signed-in users away from the auth pages.
Acceptance criteria:
- `/signin` authenticates valid credentials and starts a session.
- Invalid credentials show a clear error and create no session.
- The header shows the signed-in user's email with a working sign-out action.
- Signed-out visitors see sign in / sign up links; signed-in users visiting `/signin` or `/signup` are redirected away.

## 8. Server-side authorization helpers
Goal: Reusable guards for Server Actions and pages.
Description: Add helpers such as `requireUser()`, `requireHousehold()` (the caller's single household plus their membership), and `requireAdmin()` that throw or redirect when the condition is not met. Cover them with unit tests using a mocked session and database. These are the standard entry point for every mutation in later tasks.
Acceptance criteria:
- `requireUser()`, `requireHousehold()`, and `requireAdmin()` are implemented and exported.
- Each returns the resolved user / household+membership / admin membership when the condition holds, and throws or redirects when it does not.
- Unit tests cover both the allowed and denied paths with a mocked session and database.

## 9. Household creation
Goal: A signed-in user with no household can create one and becomes its admin.
Description: Build a "Create household" page and Server Action that creates the `Household`, creates a `Membership` with role `admin` for the current user, and copies the built-in categories into that household. Enforce the one-household-per-user rule by redirecting users who already belong to a household. After creation, redirect to the chores screen.
Acceptance criteria:
- A signed-in user with no household can create one via a page and Server Action.
- The creator receives a `Membership` with role `admin`.
- The built-in categories are copied into the new household.
- Users who already belong to a household are redirected away from the create page.
- After creation the user lands on the chores screen.

## 10. Members and invites page
Goal: An admin page to see household members and produce an invite link.
Description: Build a page listing every membership in the caller's household with name, email, and role. Give admins an action that creates an `InviteToken` with a random opaque token and an expiry (e.g. 7 days) and shows the copyable invite URL, a way to regenerate it, and an action to remove a member (never the last admin or themselves). Non-admins can view the member list but not the invite or removal controls.
Acceptance criteria:
- The page lists every membership in the caller's household with name, email, and role.
- An admin can create an `InviteToken` (random token + expiry), see a copyable invite URL, and regenerate it.
- An admin can remove a member, but not the last admin and not themselves through this control.
- Non-admins see the member list but not the invite or remove controls.

## 11. Invite acceptance
Goal: Opening a valid invite link adds the visitor to the household.
Description: Add an `/invite/[token]` route that validates the token is known, unexpired, and unconsumed. A signed-in user without a household gets a new `member` membership and the token is marked consumed; a signed-out visitor is routed to sign up or sign in and returned to the link afterward. Show distinct messaging for expired, consumed, unknown, and already-in-a-household cases.
Acceptance criteria:
- `/invite/[token]` validates that the token is known, unexpired, and unconsumed.
- A signed-in user with no household is added as a `member` and the token is marked consumed.
- A signed-out visitor is routed to sign up / sign in and returned to the invite link afterward.
- Expired, consumed, unknown, and already-in-a-household cases each show distinct messaging and add no membership.

## 12. Category management
Goal: A household can view its categories and add or remove custom ones.
Description: Build a categories page that lists the household's categories, marking built-in ones as non-deletable. Add Server Actions to create a custom category (unique name within the household) and delete a custom category, clearing that category on any chores that referenced it. Any member may manage categories.
Acceptance criteria:
- The categories page lists the household's categories and marks built-ins as non-deletable.
- A custom category can be created; a duplicate name within the household is rejected.
- Deleting a custom category clears it from any chores that referenced it.
- Any member, not only admins, can create and delete custom categories.

## 13. Create a chore — core fields
Goal: A member can create a basic chore from a form.
Description: Build the `/chores/new` form with title, optional due date and time, priority (Low/Medium/High/Urgent), effort (Small/Medium/Large), and category chosen from the household's categories. The Server Action validates input and creates a `pending` `Chore` with assignment mode defaulting to fixed and no assignees, then redirects to the chore list. Recurrence and assignment options are added by a separate task.
Acceptance criteria:
- `/chores/new` has fields for title, optional due date and time, priority, effort, and category from the household's categories.
- The Server Action validates input and creates a `pending` chore with assignment mode fixed and no assignees.
- Invalid input is rejected with visible messages.
- A successful create redirects to the chore list.

## 14. Chore form — recurrence and assignment
Goal: The new-chore form also captures recurrence and how the chore is assigned.
Description: Extend the `/chores/new` form and its Server Action with a recurrence frequency field (None/Daily/Weekly/Monthly), an assignment mode choice (Fixed or Claim), and, when Fixed, a multi-select of household members. Persist the recurrence value on the `Chore` and create `ChoreAssignee` rows for any selected members. Claim-mode chores are created with no assignees.
Acceptance criteria:
- The form adds a recurrence frequency (None/Daily/Weekly/Monthly) and an assignment mode (Fixed or Claim).
- When Fixed, a household-member multi-select is shown and selected members become `ChoreAssignee` rows.
- The recurrence value is persisted on the chore.
- Claim-mode chores are created with no assignees.

## 15. Chore list views
Goal: A shared chore list powering both the household list and the personal dashboard.
Description: Build a reusable chore list/row component showing title, category, priority, effort, due date, assignees, and status, with an "overdue" badge derived at read time (status `pending` and `dueAt` in the past). Use it for a household-wide list with filters (status, overdue only, category) sorted by due date with undated chores last, and for the post-sign-in dashboard that shows only chores the current user is assigned to or has claimed and that are still `pending`, overdue first. The dashboard is the default landing route and links through to the full household list.
Acceptance criteria:
- A reusable list/row component shows title, category, priority, effort, due date, assignees, and status.
- An "overdue" badge is shown for `pending` chores with a past `dueAt`, derived at read time with no stored status.
- The household list offers filters for status, overdue-only, and category, sorted by due date with undated chores last.
- The dashboard is the default landing route, shows only the current user's assigned or claimed `pending` chores overdue-first, and links to the household list.

## 16. Complete a chore
Goal: An assignee can mark a chore complete, and it is recorded.
Description: Add a "Complete" action available to any assignee of a chore (or any member for a claim chore they hold). It sets the chore status to `completed` and writes a `CompletionRecord` with the user and timestamp inside one transaction. For multi-assignee chores, one person completing it completes the whole chore.
Acceptance criteria:
- "Complete" is available to any assignee, and to the current claimant for a claim chore.
- Completing sets status to `completed` and writes a `CompletionRecord` (user + timestamp) in one transaction.
- For a multi-assignee chore, one completion completes the whole chore.
- A user who is not an assignee (or claimant) cannot complete the chore.

## 17. Recurring chore roll-over
Goal: Completing a recurring chore creates its next occurrence.
Description: Extend the completion transaction so that when the completed chore has a recurrence frequency other than none, a new `pending` chore is created with the same title, priority, effort, category, assignment mode, assignees, and recurrence, and a `dueAt` advanced by one day, week, or month from the previous due date (or from completion time if it had none). The original chore stays `completed`. Add tests for each frequency and for the no-due-date case.
Acceptance criteria:
- Completing a chore whose recurrence is not none creates a new `pending` chore in the same transaction.
- The new chore copies title, priority, effort, category, assignment mode, assignees, and recurrence.
- The new `dueAt` is the previous `dueAt` advanced by one day/week/month, or completion time plus the interval when there was no due date.
- The original chore remains `completed`.
- Tests cover daily, weekly, monthly, and the no-due-date case.

## 18. Skip a chore
Goal: A chore can be skipped with a required reason.
Description: Add a "Skip" action with a modal or form that requires a non-empty reason. The Server Action sets status to `skipped` and writes a `SkipRecord` with the user, reason, and timestamp. A skipped recurring chore does not generate a next occurrence in the MVP; note this near the control.
Acceptance criteria:
- The "Skip" action requires a non-empty reason before it can be submitted.
- Skipping sets status to `skipped` and writes a `SkipRecord` with user, reason, and timestamp.
- A skipped recurring chore does not generate a next occurrence.
- The reason requirement is enforced server-side, not only in the UI.

## 19. Claim and release claim-based chores
Goal: Members can claim an unassigned claim-mode chore and release it.
Description: For chores with assignment mode `claim` and no current assignee, show a "Claim" action that creates a `ChoreAssignee` row for the current user; when the caller is the current claimant, show "Release" to remove it. Claiming is limited to one active claimant at a time. Reflect the claim state in the list and dashboard views.
Acceptance criteria:
- A `claim`-mode chore with no assignee shows a "Claim" action that adds the current user as a `ChoreAssignee`.
- The current claimant sees a "Release" action that removes their assignment.
- A chore has at most one active claimant at a time.
- Claim state is reflected in the list and dashboard views.

## 20. Edit and delete a chore
Goal: Chore details can be corrected, and chores can be removed.
Description: Add an edit form (same fields as creation, including recurrence and assignment) usable by any member, updating the `Chore` and its `ChoreAssignee` rows. Add a delete action restricted to admins that removes the chore and its assignee, completion, and skip records. Guard both with the authorization helpers and confirm destructive deletes in the UI.
Acceptance criteria:
- Any member can edit a chore through a form with the same fields as creation (including recurrence and assignment), and changes persist, including assignee changes.
- Only admins can delete a chore; the control is hidden or blocked for members.
- Deleting removes the chore and its assignee, completion, and skip records.
- The delete is confirmed in the UI.
- Both actions go through the authorization helpers.

## 21. Deployment configuration
Goal: The app can be deployed to Vercel against a hosted Postgres database.
Description: Document required environment variables (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`) in `.env.example` and the README, and add a build step that runs `prisma migrate deploy`. Verify a clean deployment path: provision a hosted Postgres instance, run migrations and the seed, and confirm sign-up through chore completion works in the deployed environment.
Acceptance criteria:
- `.env.example` and the README document `DATABASE_URL`, `AUTH_SECRET`, and `AUTH_URL`.
- The build/deploy step runs `prisma migrate deploy`.
- A clean Vercel deployment against hosted Postgres is verified: migrations and seed run, and sign-up through chore completion works in the deployed environment.
