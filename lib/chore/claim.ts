import type { Chore, Prisma } from "@prisma/client";

// Claiming and releasing a claim chore, inside a transaction the caller
// opened. The caller has already locked the Household row and re-read the
// caller's membership, so the lock order is Household → Chore, as in
// `lib/chore/complete.ts`. The Household lock is what keeps two claims from
// interleaving; the `ChoreAssignee (choreId, userId)` unique is only a
// backstop against the same user inserting twice.

/** An assignee row with the person's membership in this household (none: a former member). */
type AssigneeWithMembership = { userId: string; user: { memberships: readonly unknown[] } };

type ChoreForClaim = {
  assignmentMode: Chore["assignmentMode"];
  status: Chore["status"];
  assignees: readonly AssigneeWithMembership[];
};

type ChoreForRelease = {
  assignmentMode: Chore["assignmentMode"];
  status: Chore["status"];
  assignees: readonly { userId: string }[];
};

/** The same test `assigneeLine` uses: a membership in this household. */
function isCurrentMember(assignee: AssigneeWithMembership): boolean {
  return assignee.user.memberships.length > 0;
}

/**
 * Whether the chore can be claimed: a pending claim chore that no current
 * member holds (no rows, or only rows of former members). Any member may
 * claim, admins included. The pages use this to decide who sees Claim;
 * `claimChoreInTransaction` applies the same rule under the lock.
 */
export function canClaim(chore: ChoreForClaim): boolean {
  return (
    chore.assignmentMode === "claim" &&
    chore.status === "pending" &&
    !chore.assignees.some(isCurrentMember)
  );
}

/**
 * Whether `userId` may release the chore: a pending claim chore they hold a
 * row for. Admins get no exception. `releaseChoreInTransaction` applies the
 * same rule under the lock.
 */
export function canRelease(chore: ChoreForRelease, userId: string): boolean {
  return (
    chore.assignmentMode === "claim" &&
    chore.status === "pending" &&
    chore.assignees.some((a) => a.userId === userId)
  );
}

/** How a claim attempt ended. Only `claimed` wrote anything. */
export type ClaimChoreOutcome =
  /** Empty, unknown, or another household's id: all answered the same. */
  | { kind: "gone" }
  /** Already completed or skipped. */
  | { kind: "not-pending" }
  /** A fixed chore. */
  | { kind: "not-claim" }
  /** The caller already holds a row, including the loser of a double submit. */
  | { kind: "claimed-by-you" }
  /** Another current member holds a row. */
  | { kind: "claimed-by-other" }
  | { kind: "claimed"; chore: Chore };

/** How a release attempt ended. Only `released` wrote anything. */
export type ReleaseChoreOutcome =
  | { kind: "gone" }
  | { kind: "not-pending" }
  | { kind: "not-claim" }
  /** The caller holds no row: unclaimed, someone else's claim, or already released. */
  | { kind: "not-claimant" }
  | { kind: "released"; chore: Chore };

export type ClaimChoreInput = {
  choreId: string;
  householdId: string;
  /** The caller, from the session. */
  userId: string;
};

/**
 * Locks the chore row (filtered by household, so another household's chore is
 * never locked) and re-reads it with its assignees and their memberships in
 * this household. Read under the Household lock, so no membership changes
 * mid-transaction. `null` means gone.
 */
async function lockAndRead(
  tx: Prisma.TransactionClient,
  { choreId, householdId }: { choreId: string; householdId: string },
) {
  if (!choreId) return null;

  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Chore" WHERE id = ${choreId} AND "householdId" = ${householdId} FOR UPDATE`;
  if (locked.length === 0) return null;

  const chore = await tx.chore.findUnique({
    where: { id: choreId },
    include: {
      assignees: {
        select: {
          userId: true,
          user: { select: { memberships: { where: { householdId }, select: { id: true } } } },
        },
      },
    },
  });
  if (!chore || chore.householdId !== householdId) return null;
  return chore;
}

/**
 * Runs the claim checks in order and, if they all pass, removes any rows left
 * by former members and inserts the caller's row. The `Chore` row itself is
 * not written. A second request waits on the lock and then sees the claim.
 */
export async function claimChoreInTransaction(
  tx: Prisma.TransactionClient,
  input: ClaimChoreInput,
): Promise<ClaimChoreOutcome> {
  const chore = await lockAndRead(tx, input);
  if (!chore) return { kind: "gone" };
  if (chore.status !== "pending") return { kind: "not-pending" };
  if (chore.assignmentMode !== "claim") return { kind: "not-claim" };
  if (chore.assignees.some((a) => a.userId === input.userId)) return { kind: "claimed-by-you" };
  if (!canClaim(chore)) return { kind: "claimed-by-other" };

  // Every remaining row belongs to a former member: it no longer holds the claim.
  const stale = chore.assignees.map((a) => a.userId);
  if (stale.length > 0) {
    await tx.choreAssignee.deleteMany({ where: { choreId: chore.id, userId: { in: stale } } });
  }
  await tx.choreAssignee.create({ data: { choreId: chore.id, userId: input.userId } });
  return { kind: "claimed", chore };
}

/**
 * Runs the release checks in order and, if they all pass, deletes only the
 * caller's row. Anyone else's row stays.
 */
export async function releaseChoreInTransaction(
  tx: Prisma.TransactionClient,
  input: ClaimChoreInput,
): Promise<ReleaseChoreOutcome> {
  const chore = await lockAndRead(tx, input);
  if (!chore) return { kind: "gone" };
  if (chore.status !== "pending") return { kind: "not-pending" };
  if (chore.assignmentMode !== "claim") return { kind: "not-claim" };
  if (!canRelease(chore, input.userId)) return { kind: "not-claimant" };

  await tx.choreAssignee.delete({
    where: { choreId_userId: { choreId: chore.id, userId: input.userId } },
  });
  return { kind: "released", chore };
}
