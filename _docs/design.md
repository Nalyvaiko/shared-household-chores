# Design

UI conventions the app follows today. Read before adding or changing UI; match
what is here rather than inventing a new pattern.

## Building blocks

- Tailwind CSS with shadcn/ui defaults (`components.json`). The primitives in
  `components/ui/` are `badge`, `button`, `dropdown-menu`, `input` and `label`.
  Add others with `npx shadcn add <name>` only when a page needs them.
- `npx shadcn add` also adds a bogus `cn` npm package to `package.json`.
  Revert that dependency and import `cn` from `@/lib/utils` (`clsx` +
  `tailwind-merge`).
- No shadcn Select or Textarea. Native `<select>` uses `nativeSelectClassName`
  from `components/ui/native-select.ts`; the skip reason `<textarea>` copies the
  Input classes. Both keep the focus ring and `aria-invalid` styles.
- A `<summary>` or `<Link>` that should look like a button uses
  `buttonVariants(...)` or `<Button asChild>`.

## Chore row actions

- `ChoreRow` renders its `actions` slot as a wrapping row (`flex flex-wrap
  gap-2`) under the details. Every row button is `size="sm"`.
- Order on a pending chore: Complete, Release, Claim, Skip, Edit. Claim never
  appears with Complete or Release, so a row shows either
  Complete/Release, Skip, Edit or Claim, Skip, Edit. A finished chore shows only
  Delete, and only to admins.
- Variants: Complete and Claim `default`; Release `outline`; the Skip summary
  `outline` and its submit `secondary`; Edit and Delete are `outline` links to
  the edit page.

## Feedback

- Chore row outcomes go to one live region per page (`ChoreFeedbackProvider`):
  a `role="status"` region for success and a `role="alert"` region for errors,
  both always in the DOM. Only the newest outcome is shown, and it survives the
  row leaving or the list emptying.
- A page-level notice that is not a row outcome (for example the filter
  `notice` on `/chores`) is its own `role="status"` paragraph.
- Errors use `text-destructive`; boxed messages use
  `rounded-md border px-4 py-3 text-sm break-words`.

## Forms

- Every form posts to a Server Action and works without JavaScript.
- Field errors: the input gets `aria-invalid` and `aria-describedby` pointing at
  an error block with `role="alert"` and `text-destructive`. The action returns
  what the user typed and the form echoes it back (`defaultValue`), so nothing
  is lost on an error. Forms that validate on the server use `noValidate`.
- Pending state: the submit button is disabled and its label becomes the verb
  in "-ing" form with an ellipsis: "Creating…", "Adding…", "Saving…",
  "Completing…", "Skipping…", "Claiming…", "Releasing…", "Deleting…",
  "Removing…", "Joining…", "Regenerating…". Row buttons read pending from
  `useFormStatus()` so only that row's button changes.

## Confirm and disclosure

- A step that needs a confirm or extra input (Skip with a reason, Delete chore)
  is an inline `<details>`: the `<summary>` is styled as an outline button and
  the form sits inside. No dialog, no JavaScript needed; closing it is the
  cancel. Opening it moves no focus.
- One-click actions (Complete, Claim, Release) have no confirm step.

## Accessible names

- Repeated row controls include the item title in their accessible name with a
  screen-reader-only suffix: `Complete<span className="sr-only"> "Title"</span>`.
- Confirm groups and menus carry an `aria-label` naming the item, e.g.
  "Confirm removing Alice", "Account menu for alice@example.com".
- Information is shown as text, never colour alone (status and Overdue badges
  have labels; hidden "Category:" / "Due:" prefixes give context).

## Dates

- `LocalDateTime` renders a `<time dateTime>` with the UTC text on the server
  ("23 Oct 2026, 14:05 UTC") and swaps to the browser's local time after
  hydration, with no hydration mismatch.

## Empty states

- One short, plain sentence in `text-muted-foreground`, ending with a period:
  "No chores yet.", "No custom categories yet.", "Nothing assigned to you right
  now.", "No chores match these filters." Add a link to the next useful place
  when there is one ("Show all chores", "All household chores").

## Narrow screens (320px and 375px)

- Pages must not scroll sideways at 320px. Use `min-w-0` on flex children that
  hold user text and `flex-wrap` on rows of controls.
- User text that may be long wraps (`break-words`; `break-all` for emails).
  Where it must stay on one line (the header household name, the account menu
  trigger), it uses `truncate` and the full text stays available: a `title`
  attribute on the household name, the full email in the menu's label and the
  trigger's `aria-label`.
- The account menu trigger is capped at `max-w-30` (`sm:max-w-64`) so the
  header title keeps its two lines at 320px.
