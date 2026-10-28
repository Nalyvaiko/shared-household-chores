// Messages for the chore row actions. Kept out of `actions.ts` because a
// "use server" module may only export async functions.

/** The same answer for an empty, unknown, or other household's chore id. */
export const CHORE_GONE_ERROR = "That chore no longer exists.";

export const CHORE_NOT_PENDING_ERROR = "This chore has already been completed or skipped.";

export const CHORE_UNCLAIMED_ERROR = "Claim this chore before completing it.";

export const CHORE_NOT_ASSIGNEE_ERROR = "Only someone assigned to this chore can complete it.";

export const CHORE_NOT_CLAIM_ERROR = "This chore isn't claim-based.";

export const CHORE_CLAIMED_BY_YOU_ERROR = "You've already claimed this chore.";

export const CHORE_CLAIMED_BY_OTHER_ERROR = "Someone else has already claimed this chore.";

export const CHORE_NOT_CLAIMANT_ERROR = "You haven't claimed this chore.";

export function choreClaimedMessage(title: string): string {
  return `Claimed "${title}".`;
}

export function choreReleasedMessage(title: string): string {
  return `Released "${title}".`;
}

export function choreCompletedMessage(title: string): string {
  return `Completed "${title}".`;
}

export function choreSkippedMessage(title: string): string {
  return `Skipped "${title}".`;
}
