# Shared Household Chores — MVP Scope

## Product Goal
A simple tool for managing shared household chores for any combination of people: couples, families, roommates, or other groups.

## Decisions Made

### Household & Users
- Any combination of people can use a household.
- Users can belong to multiple households.
- Each user has one primary household.
- Anyone can create a household and automatically becomes its admin.
- Household membership is invite-only.
- Admins invite people by email.
- Households support custom roles and permissions.
- Chore visibility can be controlled by permissions.
- Who can create/edit chores is configurable per household.

### Chores
- One chore = one task.
- No subtasks.
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
- No notifications in the MVP.

### Assignment
A chore can have multiple assignees.

Supported assignment modes:
- Fixed assignment
- Rotating assignment
- Claim-based assignment

For MVP, assignment can be handled by the admin or chore creator depending on the chosen household permissions.

When multiple people are assigned:
- Any one assigned person completing the chore marks the whole chore complete.

### Recurring Chores
- Users can set standard frequencies such as:
  - Daily
  - Weekly
  - Monthly
- When a recurring chore is completed, the next occurrence is automatically created.

### Completion
When a chore is completed, record:
- Who completed it
- Completion time

The MVP does **not** provide a user-facing completion history, statistics, or leaderboards.

### Skipping
- Chores can be skipped.
- A reason is required when skipping.

### Missed Chores
- If a chore passes its due date without completion, it becomes overdue.
- The responsible person is notified.

Note: Notifications were otherwise excluded from the MVP. The simplest MVP interpretation is to keep overdue state visible in the app and defer actual push/email notifications until a later version.

### Dashboard
The default dashboard is:
- My Assigned Chores

Visibility of other household chores depends on permissions.

### Initial Status
Keep the status model simple:
- Pending
- Completed
- Skipped
- Overdue

## Authentication
For a simple MVP:
- Email + password authentication.

## UI
Keep the initial UI simple:
- Primary focus: list of chores
- No calendar view initially.

## Explicitly Out of Scope for MVP
- Push notifications
- Email notifications
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
2. User creates a household and becomes admin.
3. Admin invites household members by email.
4. Household members join.
5. Users create chores according to household permissions.
6. A chore is assigned using the configured assignment mode.
7. Assigned users see their chores on the dashboard.
8. A user completes or skips a chore.
9. Completion records the user and timestamp.
10. If recurring, the next occurrence is automatically created.
11. If a due date passes, the chore becomes overdue.

## MVP Philosophy
Keep the first version focused on:
- Households
- Users and permissions
- Chores
- Assignments
- Recurrence
- Completion
- Skipping
- Due dates
- Simple dashboard

Avoid features that add significant complexity without being necessary to prove the core product.