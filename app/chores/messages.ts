// Messages for the chore row actions. Kept out of `actions.ts` because a
// "use server" module may only export async functions.

/** The same answer for an empty, unknown, or other household's chore id. */
export const CHORE_GONE_ERROR = "That chore no longer exists.";

export const CHORE_NOT_PENDING_ERROR = "This chore has already been completed or skipped.";

export const CHORE_UNCLAIMED_ERROR = "Claim this chore before completing it.";

export const CHORE_NOT_ASSIGNEE_ERROR = "Only someone assigned to this chore can complete it.";

export function choreCompletedMessage(title: string): string {
  return `Completed "${title}".`;
}

export function choreSkippedMessage(title: string): string {
  return `Skipped "${title}".`;
}
