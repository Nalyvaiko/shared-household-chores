// Messages for the invite page and its Join action. Kept out of `actions.ts`
// because a "use server" module may only export async functions.

import type { InviteStatus } from "@/lib/household/invite";

/** Every status that ends without joining, except "already a member here". */
export type InviteProblem = Exclude<InviteStatus, "valid" | "member-here">;

/**
 * The unknown, used and expired messages never name the household, and the
 * other-household one does not name the invite's household either.
 */
export const INVITE_PROBLEM_MESSAGES: Record<InviteProblem, { title: string; body: string }> = {
  unknown: {
    title: "Invite link not found",
    body: "This invite link isn't valid. Ask a household admin to send you a new one.",
  },
  "other-household": {
    title: "You already belong to a household",
    body: "You can only be in one household, so you can't join another one with this link.",
  },
  used: {
    title: "Invite link already used",
    body: "Someone has already joined with this invite link. Ask a household admin for a new one.",
  },
  expired: {
    title: "Invite link expired",
    body: "This invite link has expired. Ask a household admin for a new one.",
  },
};
