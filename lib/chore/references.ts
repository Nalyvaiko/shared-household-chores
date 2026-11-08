import type { Prisma } from "@prisma/client";

import { isPlausibleId } from "@/lib/form-id";

// Checks that a chore form's category and picked members belong to the
// household. Shared by the create and edit actions; kept out of their
// "use server" modules, where every async export would be a callable endpoint.
// A posted id that cannot be an id (control characters, over-long, blank) is
// answered like an unknown one without being queried.

/** Whether the id names one of this household's categories. */
export async function categoryBelongs(
  client: Pick<Prisma.TransactionClient, "category">,
  categoryId: string,
  householdId: string,
): Promise<boolean> {
  if (!isPlausibleId(categoryId)) return false;
  const category = await client.category.findUnique({ where: { id: categoryId } });
  // Another household's id gets the same answer as an unknown one.
  return category !== null && category.householdId === householdId;
}

/**
 * The ids that are not a current member of the household: unknown, empty,
 * malformed, another household's user, or removed. Older assignee rows don't
 * count. Only plausible ids are queried.
 */
export async function nonMemberIds(
  client: Pick<Prisma.TransactionClient, "membership">,
  userIds: string[],
  householdId: string,
): Promise<string[]> {
  const queried = userIds.filter((id) => isPlausibleId(id));
  const rows =
    queried.length === 0
      ? []
      : await client.membership.findMany({
          where: { householdId, userId: { in: queried } },
          select: { userId: true },
        });
  const members = new Set(rows.map((row) => row.userId));
  return userIds.filter((id) => !members.has(id));
}

/**
 * Whether the posted category (when one is picked) or a picked member id
 * cannot be an id at all. Such a reference is always answered as gone, so the
 * actions can refuse it before opening a transaction.
 */
export function hasMalformedReference(categoryId: string, userIds: readonly string[]): boolean {
  return (
    (categoryId !== "" && !isPlausibleId(categoryId)) || userIds.some((id) => !isPlausibleId(id))
  );
}
