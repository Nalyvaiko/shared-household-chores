import type { Chore, Prisma } from "@prisma/client";

// Skipping a chore, inside a transaction the caller opened. The caller has
// already locked the Household row and re-read the caller's membership, so
// the lock order is Household → Chore, as in `lib/chore/complete.ts`.
//
// A skip never rolls a recurring chore over: its series ends here. So this
// module shares nothing with completion and never computes a next due date.

/** How a skip attempt ended. Only `skipped` wrote anything. */
export type SkipChoreOutcome =
  /** Empty, unknown, or another household's id: all answered the same. */
  | { kind: "gone" }
  /** Already completed or skipped, including the loser of a race. */
  | { kind: "not-pending" }
  | { kind: "skipped"; chore: Chore };

export type SkipChoreInput = {
  choreId: string;
  householdId: string;
  /** The caller, from the session. Any member may skip; no assignee check. */
  userId: string;
  /** Already validated and normalised. */
  reason: string;
  /** Captured on the server when the request started. */
  now: Date;
};

/**
 * Locks the chore row, re-reads it and, if it is still pending, marks it
 * skipped and writes its `SkipRecord`. Assignee rows are left as they are.
 * A second request for the same chore (Skip or Complete) waits on the lock
 * and then sees it is no longer pending.
 */
export async function skipChoreInTransaction(
  tx: Prisma.TransactionClient,
  { choreId, householdId, userId, reason, now }: SkipChoreInput,
): Promise<SkipChoreOutcome> {
  if (!choreId) return { kind: "gone" };

  // Filtered by household, so another household's chore is never locked.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Chore" WHERE id = ${choreId} AND "householdId" = ${householdId} FOR UPDATE`;
  if (locked.length === 0) return { kind: "gone" };

  const chore = await tx.chore.findUnique({ where: { id: choreId } });
  if (!chore || chore.householdId !== householdId) return { kind: "gone" };
  if (chore.status !== "pending") return { kind: "not-pending" };

  // `update` (not `updateMany`) so `updatedAt` moves.
  const skipped = await tx.chore.update({
    where: { id: chore.id },
    data: { status: "skipped" },
  });
  // The server's `now`, not the column default.
  await tx.skipRecord.create({
    data: { choreId: chore.id, userId, reason, skippedAt: now },
  });
  return { kind: "skipped", chore: skipped };
}
