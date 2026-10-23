import type { AssignmentMode, ChoreStatus, Prisma } from "@prisma/client";

// Pure helpers behind the chore list views (`/chores` and the `/` dashboard):
// filter parsing, the Prisma `where`/`orderBy`/`include`, the derived
// "overdue" state and the assignee line.

/** The status filter values `/chores` accepts. */
export type StatusFilter = ChoreStatus | "all";

/** The filters in effect on `/chores`, after invalid values are dropped. */
export type ChoreFilters = {
  status: StatusFilter;
  overdueOnly: boolean;
  /** A category id of this household, "none" for uncategorised, or null for all. */
  category: string | null;
};

export const DEFAULT_CHORE_FILTERS: ChoreFilters = {
  status: "pending",
  overdueOnly: false,
  category: null,
};

const STATUS_FILTERS: readonly StatusFilter[] = ["pending", "completed", "skipped", "all"];

type SearchParams = Record<string, string | string[] | undefined>;

/** A parameter's value when it appears exactly once; a repeated one counts as invalid. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads the `/chores` filters from the URL. Each parameter is checked on its
 * own; an unknown, wrong-case or repeated value falls back to that
 * parameter's default. `categoryIds` are the caller's household's categories:
 * any other `category` id (another household's, a deleted one, garbage) means
 * "all categories".
 */
export function parseChoreFilters(
  searchParams: SearchParams,
  categoryIds: readonly string[],
): ChoreFilters {
  const status = single(searchParams.status);
  const overdue = single(searchParams.overdue);
  const category = single(searchParams.category);

  return {
    status: STATUS_FILTERS.includes(status as StatusFilter)
      ? (status as StatusFilter)
      : DEFAULT_CHORE_FILTERS.status,
    overdueOnly: overdue === "1",
    category:
      category === "none" || (category !== undefined && categoryIds.includes(category))
        ? category
        : null,
  };
}

/**
 * The `where` for `/chores`: the caller's household plus every filter, ANDed.
 * Overdue-only is `status = pending AND dueAt < now`, so with
 * `status=completed` or `status=skipped` it matches nothing.
 */
export function choreListWhere(
  householdId: string,
  filters: ChoreFilters,
  now: Date,
): Prisma.ChoreWhereInput {
  const and: Prisma.ChoreWhereInput[] = [];
  if (filters.status !== "all") and.push({ status: filters.status });
  if (filters.overdueOnly) and.push({ status: "pending", dueAt: { lt: now } });
  if (filters.category === "none") and.push({ categoryId: null });
  else if (filters.category) and.push({ categoryId: filters.category });

  return and.length ? { householdId, AND: and } : { householdId };
}

/**
 * The `where` for the dashboard: pending chores in the caller's household
 * that have an assignee row for the caller (fixed assignments and claims).
 */
export function myChoresWhere(householdId: string, userId: string): Prisma.ChoreWhereInput {
  return { householdId, status: "pending", assignees: { some: { userId } } };
}

/** Earliest due first, undated last, then oldest first; `id` keeps it stable. */
export const CHORE_LIST_ORDER_BY = [
  { dueAt: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.ChoreOrderByWithRelationInput[];

/**
 * What a list row needs, loaded with the chore in the same query: the
 * category name and each assignee with their membership in this household
 * (none means they have been removed from it).
 */
export function choreListInclude(householdId: string) {
  return {
    category: { select: { name: true } },
    assignees: {
      select: {
        userId: true,
        user: {
          select: {
            name: true,
            email: true,
            memberships: { where: { householdId }, select: { id: true } },
          },
        },
      },
    },
  } satisfies Prisma.ChoreInclude;
}

/** A chore as loaded with `choreListInclude()`. */
export type ChoreListItem = Prisma.ChoreGetPayload<{
  include: ReturnType<typeof choreListInclude>;
}>;

/**
 * Overdue is derived, never stored: pending and due strictly before `now`.
 * A chore due exactly at `now` is not overdue yet.
 */
export function isOverdue(
  chore: { status: ChoreStatus; dueAt: Date | null },
  now: Date,
): boolean {
  return chore.status === "pending" && chore.dueAt !== null && chore.dueAt.getTime() < now.getTime();
}

type AssigneeForLine = {
  userId: string;
  user: { name: string | null; email: string; memberships: readonly unknown[] };
};

/** Name, falling back to email, like the members page. */
function personLabel(user: { name: string | null; email: string }): string {
  return user.name || user.email;
}

/**
 * "Assigned to Alice (you), Bob" / "Unassigned" for fixed chores and
 * "Claimed by Bob" / "Unclaimed" for claim chores. People are sorted by label
 * (case- and accent-insensitive), ties by user id. The viewer gets " (you)";
 * someone with no membership in this household gets " (former member)".
 */
export function assigneeLine(
  chore: { assignmentMode: AssignmentMode; assignees: readonly AssigneeForLine[] },
  viewerId: string,
): string {
  if (chore.assignees.length === 0) {
    return chore.assignmentMode === "claim" ? "Unclaimed" : "Unassigned";
  }

  const people = chore.assignees
    .map((assignee) => ({
      userId: assignee.userId,
      label: personLabel(assignee.user),
      isSelf: assignee.userId === viewerId,
      isFormer: assignee.user.memberships.length === 0,
    }))
    .sort((a, b) => {
      const byLabel = a.label.localeCompare(b.label, "en", { sensitivity: "base" });
      if (byLabel !== 0) return byLabel;
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    })
    .map(
      (person) =>
        person.label + (person.isSelf ? " (you)" : "") + (person.isFormer ? " (former member)" : ""),
    )
    .join(", ");

  return chore.assignmentMode === "claim" ? `Claimed by ${people}` : `Assigned to ${people}`;
}
