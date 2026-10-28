import type { AssignmentMode, Chore, Membership } from "@prisma/client";

// Rules for editing a chore. `_docs/plan.md`: "Who assigns a chore: the chore
// creator or any admin." Every other member edits the other fields only.

/** Whether the member may change the chore's assignment mode and assignees. */
export function canChangeAssignment(
  chore: Pick<Chore, "createdById">,
  member: Pick<Membership, "userId" | "role">,
): boolean {
  return member.role === "admin" || chore.createdById === member.userId;
}

/** The assignee rows an edit deletes and inserts. */
export type AssigneeChanges = {
  /** Delete every row of the chore. */
  deleteAll: boolean;
  /** Delete only these users' rows (never set together with `deleteAll`). */
  deleteIds: string[];
  /** Insert a row for each of these users. */
  insertIds: string[];
};

/**
 * The row changes for a mode transition:
 * - Claim → Claim: none, so the current claim (a former member's too) stays.
 * - Fixed → Claim: every row goes; the chore is unclaimed.
 * - Claim → Fixed: every row (the claim) goes and each ticked member gets one.
 * - Fixed → Fixed: a current member's row without a tick goes, a tick without
 *   a row gets one, and matching rows are untouched. Former members' rows
 *   (`formerIds`) can't be ticked or unticked, so they stay.
 */
export function assigneeChanges({
  from,
  to,
  existingIds,
  formerIds,
  tickedIds,
}: {
  from: AssignmentMode;
  to: AssignmentMode;
  existingIds: readonly string[];
  formerIds: readonly string[];
  tickedIds: readonly string[];
}): AssigneeChanges {
  const ticked = [...new Set(tickedIds)];
  if (to === "claim") {
    return { deleteAll: from === "fixed", deleteIds: [], insertIds: [] };
  }
  if (from === "claim") {
    return { deleteAll: true, deleteIds: [], insertIds: ticked };
  }
  return {
    deleteAll: false,
    deleteIds: existingIds.filter((id) => !formerIds.includes(id) && !ticked.includes(id)),
    insertIds: ticked.filter((id) => !existingIds.includes(id)),
  };
}
