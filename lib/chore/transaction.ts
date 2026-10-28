import "server-only";

import { Prisma, type Membership } from "@prisma/client";

import { db } from "@/lib/db";

// The transaction every chore mutation runs in. A plain module, not a
// "use server" one: there every async export would be a callable endpoint.

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Runs a chore mutation in one transaction, after locking the Household (the
 * lock member removal takes) and re-reading the caller's membership: they may
 * have been removed, or their role changed, since the page loaded. `work`
 * gets the re-read membership. A unique violation is answered with
 * `onUniqueViolation` when the action gives one, and rethrown otherwise.
 */
export async function inHouseholdTransaction<
  T extends { kind: string },
  U extends { kind: string } = never,
>(
  householdId: string,
  userId: string,
  work: (tx: Prisma.TransactionClient, caller: Membership) => Promise<T>,
  onUniqueViolation?: U,
): Promise<T | { kind: "caller-gone" } | U> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;
      const caller = await tx.membership.findUnique({
        where: { userId_householdId: { userId, householdId } },
      });
      if (!caller) return { kind: "caller-gone" } as const;

      return work(tx, caller);
    });
  } catch (error) {
    // The locks should make this unreachable; the unique is the backstop.
    if (onUniqueViolation === undefined || !isUniqueViolation(error)) throw error;
    return onUniqueViolation;
  }
}
