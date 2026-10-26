import type { Chore, Prisma } from "@prisma/client";

import { nextDueAt } from "@/lib/chore/recurrence";

// Completing a chore, inside a transaction the caller opened. The caller has
// already locked the Household row and re-read the caller's membership, so
// the lock order is always Household → Chore (the same order every chore
// mutation takes, so they serialize without deadlocks).

/** How a completion attempt ended. Only `completed` wrote anything. */
export type CompleteChoreOutcome =
  /** Empty, unknown, or another household's id: all answered the same. */
  | { kind: "gone" }
  /** Already completed or skipped, including the loser of a double submit. */
  | { kind: "not-pending" }
  /** A claim chore nobody has claimed. */
  | { kind: "unclaimed" }
  /** The caller has no assignee row for the chore. */
  | { kind: "not-assignee" }
  | { kind: "completed"; chore: Chore };

export type CompleteChoreInput = {
  choreId: string;
  householdId: string;
  /** The caller, from the session. */
  userId: string;
  /** Captured on the server when the request started. */
  now: Date;
};

/**
 * Whether `userId` may complete the chore: it is pending and they have an
 * assignee row for it (for a claim chore, that means they hold the claim).
 * Admins get no exception. The pages use this to decide who sees the button;
 * `completeChoreInTransaction` applies the same rule under the lock.
 */
export function canComplete(
  chore: { status: Chore["status"]; assignees: readonly { userId: string }[] },
  userId: string,
): boolean {
  return chore.status === "pending" && chore.assignees.some((a) => a.userId === userId);
}

/**
 * Locks the chore row, re-reads it with its assignees, runs the checks in
 * order and, if they all pass, marks it completed, writes its
 * `CompletionRecord` and, for a recurring chore, creates its next pending
 * occurrence. A second request for the same chore waits on the lock
 * and then sees `completed`.
 */
export async function completeChoreInTransaction(
  tx: Prisma.TransactionClient,
  { choreId, householdId, userId, now }: CompleteChoreInput,
): Promise<CompleteChoreOutcome> {
  if (!choreId) return { kind: "gone" };

  // Filtered by household, so another household's chore is never locked.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Chore" WHERE id = ${choreId} AND "householdId" = ${householdId} FOR UPDATE`;
  if (locked.length === 0) return { kind: "gone" };

  const chore = await tx.chore.findUnique({
    where: { id: choreId },
    include: { assignees: { select: { userId: true } } },
  });
  if (!chore || chore.householdId !== householdId) return { kind: "gone" };
  if (chore.status !== "pending") return { kind: "not-pending" };
  if (chore.assignmentMode === "claim" && chore.assignees.length === 0) {
    return { kind: "unclaimed" };
  }
  if (!canComplete(chore, userId)) return { kind: "not-assignee" };

  // `update` (not `updateMany`) so `updatedAt` moves.
  const completed = await tx.chore.update({
    where: { id: chore.id },
    data: { status: "completed" },
  });
  // The server's `now`, not the column default, so roll-over (#17) can use
  // the same instant.
  await tx.completionRecord.create({
    data: { choreId: chore.id, userId, completedAt: now },
  });

  // Roll-over: a recurring chore gets its next pending occurrence in the same
  // transaction, so a throw here rolls the completion back too. A fixed chore
  // keeps the assignee set read under the lock (removed members included); a
  // claim chore starts unclaimed.
  if (chore.recurrence !== "none") {
    await tx.chore.create({
      data: {
        householdId: chore.householdId,
        createdById: chore.createdById,
        title: chore.title,
        priority: chore.priority,
        effort: chore.effort,
        categoryId: chore.categoryId,
        assignmentMode: chore.assignmentMode,
        recurrence: chore.recurrence,
        status: "pending",
        dueAt: nextDueAt(chore.recurrence, chore.dueAt, now),
        ...(chore.assignmentMode === "fixed" && {
          assignees: { create: chore.assignees.map((a) => ({ userId: a.userId })) },
        }),
      },
    });
  }
  return { kind: "completed", chore: completed };
}
