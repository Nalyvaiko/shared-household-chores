# Shared Household Chores — MVP Scope (Next.js-Optimized)

## Product Goal
A simple tool for managing shared household chores for any combination of people: couples, families, roommates, or other groups.

## MVP Philosophy
Keep the first version focused on proving the core product:
- Households
- Users and simple roles
- Chores
- Assignments
- Recurrence
- Completion
- Skipping
- Due dates
- Simple dashboard

Deliberately avoid anything that forces extra infrastructure (a permissions engine,
a background job runner, or an email service) so the whole app can be built as a
Next.js app with Server Actions on top of PostgreSQL — no queue, no Redis, no mail provider.

## Target Tech Stack
- **Next.js** (App Router), Server Actions for all mutations
- **PostgreSQL** (hosted: Neon / Supabase / Railway)
- **Prisma** ORM (Drizzle is an acceptable alternative)
- **Auth.js v5** Credentials provider + bcrypt — or **Clerk** to skip auth plumbing
- **Tailwind CSS + shadcn/ui**
- Deploy to **Vercel** + hosted Postgres

No message queue, no Redis, no transactional email in the MVP.

## Decisions Made

### Household & Users
- Any combination of people can use a household.
- Anyone can create a household and automatically becomes its admin.
- **One household per user for the MVP.** No "primary household", no household switcher.
  - `membership` is still modeled as a join table (user ↔ household) so multi-household
    support can be added later without a data migration.
- Household membership is invite-only.

### Roles & Permissions
Two fixed roles. No custom roles, no configurable permissions, no permissions UI.

- **Admin**
  - Manage members and invites
  - Edit household settings
  - Delete any chore
  - Everything a member can do
- **Member**
  - Create chores
  - Edit, complete, or skip any chore in the household

Everyone in a household sees all chores in that household. Chore visibility is not
configurable in the MVP.

Enforcement is a simple `if (role === "admin")` check inside Server Actions.

### Invites
- An admin generates a **signed invite link** (random token row with an expiry).
- The admin shares that link by whatever channel they choose.
- Opening the link:
  - If the visitor is signed in, they join the household.
  - If not, they sign up (or sign in) and are then added to the household.
- No email is sent by the app.

### Chores
- One chore = one task. No subtasks.
- Chores can have:
  - Title
  - Optional due date/time
  - Priority: Low / Medium / High / Urgent
  - Effort: Small / Medium / Large
  - Category
  - Assignment
- Categories support both built-in and custom categories.
- No comments.
- No attachments/photos.
- No notifications.

### Assignment
A chore can have multiple assignees.

Supported assignment modes for the MVP:
- **Fixed assignment** — specific people are assigned.
- **Claim-based assignment** — the chore is unassigned until a household member claims it.

**Rotating assignment is deferred** (it needs stored rotation order + a rotation index
plus edge-case handling when a member leaves mid-rotation).

Who assigns a chore: the chore creator or any admin.

When multiple people are assigned:
- Any one assigned person completing the chore marks the whole chore complete.

### Recurring Chores
- Standard frequencies: Daily / Weekly / Monthly.
- When a recurring chore is completed, the next occurrence is created
  **synchronously, in the same database transaction as the completion**.
- No scheduler or background worker is involved.

### Completion
When a chore is completed, record:
- Who completed it
- Completion time

The MVP does **not** provide a user-facing completion history, statistics, or leaderboards.

### Skipping
- Chores can be skipped.
- A reason is required when skipping.

### Missed / Overdue Chores
- "Overdue" is **derived at read time**: a chore is overdue when its status is
  `Pending` and its due date/time is in the past.
- Overdue chores are surfaced in the UI as a badge and a filter.
- There is no stored `Overdue` status and no notification.

### Status Model
Stored statuses:
- Pending
- Completed
- Skipped

`Overdue` is a derived view over `Pending`, not a stored value.

### Dashboard
The default dashboard is **My Assigned Chores** — implemented as a filter over the
household's chores, not as a permission boundary. Users can also view all household chores.

## Authentication
- Email + password (Auth.js Credentials + bcrypt), or hosted auth via Clerk.
- **Password reset is deferred** for the MVP (it is the one auth flow that would
  require email). Using Clerk removes this limitation if reset is needed sooner.

## UI
- Primary focus: list of chores.
- No calendar view.

## Explicitly Out of Scope for MVP
- Custom roles and configurable permissions
- Configurable chore visibility
- Rotating assignment
- Multi-household membership / household switching
- Email-based invites (link-based instead)
- Password reset (unless Clerk is used)
- Push notifications
- Email notifications
- Overdue / assignment notifications
- Comments
- Photos/attachments
- Subtasks
- Completion history UI
- Household statistics
- Leaderboards
- Calendar view
- Complex reporting
- Gamification

## Core User Flow
1. User creates an account.
2. User creates a household and becomes its admin.
3. Admin generates an invite link and shares it.
4. Invited people open the link, sign up or sign in, and join the household.
5. Members create chores.
6. A chore is assigned as Fixed or left for someone to Claim.
7. Assigned users see their chores on the dashboard (My Assigned Chores).
8. A user completes or skips a chore (skipping requires a reason).
9. Completion records the user and timestamp.
10. If the chore is recurring, the next occurrence is created in the same transaction.
11. If a due date passes while a chore is still Pending, it is shown as overdue.

## Deferred Features — Reintroduction Notes
These were cut to keep the MVP on a plain Next.js stack. Each can be added later:
- **Custom roles / permissions** — add a `role` + `permission` model per household and
  a policy helper; replace the `role === "admin"` checks.
- **Rotating assignment** — add rotation order + rotation index to the chore; advance on completion.
- **Multi-household** — reuse the existing `membership` join table; add a "current household"
  selector and a `primaryHouseholdId` on the user.
- **Email invites & notifications** — add a transactional email provider (Resend / Postmark);
  send the existing invite link by email, then layer overdue/assignment notifications.
- **Overdue as a real state + notifications** — add a scheduled sweep (Vercel Cron) that
  materializes `Overdue` and triggers notifications.
- **Password reset** — add email provider and a reset-token flow, or switch auth to Clerk.
