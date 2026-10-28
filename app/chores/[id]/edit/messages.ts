// Copy for the edit-chore page and its actions. Kept out of `actions.ts`
// because a "use server" module may only export async functions.

export const CHORE_NOT_EDITABLE_TEXT =
  "This chore has already been completed or skipped, so it can't be edited.";

export const ASSIGNMENT_READ_ONLY_TEXT =
  "Only the person who created this chore or an admin can change how it's assigned.";

export function deleteChoreQuestion(title: string): string {
  return `Delete "${title}"? This can't be undone.`;
}

export const DELETE_RECURRING_NOTE = "It repeats, so this also ends the series.";

/** The notices `/chores?notice=…` shows after a save or a delete. */
export const CHORE_NOTICES = {
  saved: "Changes saved.",
  deleted: "Chore deleted.",
} as const;

export type ChoreNotice = keyof typeof CHORE_NOTICES;

/** The notice text for a `notice` search param, or null for a missing or unknown one. */
export function choreNoticeText(value: string | string[] | undefined): string | null {
  return value === "saved" || value === "deleted" ? CHORE_NOTICES[value] : null;
}

/** A "Due …" line for the no-JavaScript view, with the UTC text the list shows. */
export function noScriptDueText(utcText: string): string {
  return `Currently due ${utcText}. Changing the due date needs JavaScript; leave the field empty to keep it.`;
}
