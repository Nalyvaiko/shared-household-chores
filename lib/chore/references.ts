import type { Prisma } from "@prisma/client";

// Checks that a chore form's category and picked members belong to the
// household. Shared by the create and edit actions; kept out of their
// "use server" modules, where every async export would be a callable endpoint.

/** Whether the id names one of this household's categories. */
export async function categoryBelongs(
  client: Pick<Prisma.TransactionClient, "category">,
  categoryId: string,
  householdId: string,
): Promise<boolean> {
  const category = await client.category.findUnique({ where: { id: categoryId } });
  // Another household's id gets the same answer as an unknown one.
  return category !== null && category.householdId === householdId;
}

/**
 * The ids that are not a current member of the household: unknown, empty,
 * another household's user, or removed. Older assignee rows don't count.
 */
export async function nonMemberIds(
  client: Pick<Prisma.TransactionClient, "membership">,
  userIds: string[],
  householdId: string,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await client.membership.findMany({
    where: { householdId, userId: { in: userIds } },
    select: { userId: true },
  });
  const members = new Set(rows.map((row) => row.userId));
  return userIds.filter((id) => !members.has(id));
}
