import { describe, expect, it } from "vitest";

import {
  CHORE_LIST_ORDER_BY,
  DEFAULT_CHORE_FILTERS,
  assigneeLine,
  choreListInclude,
  choreListWhere,
  isOverdue,
  myChoresWhere,
  parseChoreFilters,
} from "@/lib/chore/list";

const now = new Date("2026-10-23T14:05:00.000Z");
const categoryIds = ["cat_kitchen", "cat_garden"];

describe("isOverdue", () => {
  it("is true for a pending chore due before now", () => {
    expect(isOverdue({ status: "pending", dueAt: new Date(now.getTime() - 1) }, now)).toBe(true);
  });

  it("is false for a pending chore due exactly now", () => {
    expect(isOverdue({ status: "pending", dueAt: new Date(now.getTime()) }, now)).toBe(false);
  });

  it("is false for a pending chore due in the future", () => {
    expect(isOverdue({ status: "pending", dueAt: new Date(now.getTime() + 60_000) }, now)).toBe(
      false,
    );
  });

  it("is false for an undated chore", () => {
    expect(isOverdue({ status: "pending", dueAt: null }, now)).toBe(false);
  });

  it("is false for completed and skipped chores, even when long past due", () => {
    const dueAt = new Date("2020-01-01T00:00:00.000Z");
    expect(isOverdue({ status: "completed", dueAt }, now)).toBe(false);
    expect(isOverdue({ status: "skipped", dueAt }, now)).toBe(false);
  });
});

describe("parseChoreFilters", () => {
  it("defaults to pending, no overdue filter and all categories", () => {
    expect(parseChoreFilters({}, categoryIds)).toEqual({
      status: "pending",
      overdueOnly: false,
      category: null,
    });
    expect(DEFAULT_CHORE_FILTERS).toEqual({ status: "pending", overdueOnly: false, category: null });
  });

  it.each(["pending", "completed", "skipped", "all"] as const)("accepts status=%s", (status) => {
    expect(parseChoreFilters({ status }, categoryIds).status).toBe(status);
  });

  it.each(["Pending", "ALL", "overdue", "", "done"])("ignores status=%j", (status) => {
    expect(parseChoreFilters({ status }, categoryIds).status).toBe("pending");
  });

  it("ignores a repeated status", () => {
    expect(parseChoreFilters({ status: ["pending", "all"] }, categoryIds).status).toBe("pending");
    expect(parseChoreFilters({ status: ["all", "all"] }, categoryIds).status).toBe("pending");
  });

  it("turns overdue-only on for overdue=1 only", () => {
    expect(parseChoreFilters({ overdue: "1" }, categoryIds).overdueOnly).toBe(true);
    for (const overdue of ["0", "true", "yes", "", "2"]) {
      expect(parseChoreFilters({ overdue }, categoryIds).overdueOnly).toBe(false);
    }
    expect(parseChoreFilters({ overdue: ["1", "1"] }, categoryIds).overdueOnly).toBe(false);
  });

  it("accepts one of the household's category ids", () => {
    expect(parseChoreFilters({ category: "cat_garden" }, categoryIds).category).toBe("cat_garden");
  });

  it("accepts category=none", () => {
    expect(parseChoreFilters({ category: "none" }, categoryIds).category).toBe("none");
  });

  it("falls back to all categories for an empty, foreign, unknown or repeated id", () => {
    for (const category of ["", "cat_other_household", "cat_deleted", "<script>", "None"]) {
      expect(parseChoreFilters({ category }, categoryIds).category).toBeNull();
    }
    expect(parseChoreFilters({ category: ["cat_kitchen", "cat_garden"] }, categoryIds).category).toBeNull();
  });

  it("checks each parameter on its own", () => {
    expect(
      parseChoreFilters(
        { status: "Completed", overdue: "1", category: "cat_kitchen" },
        categoryIds,
      ),
    ).toEqual({ status: "pending", overdueOnly: true, category: "cat_kitchen" });
    expect(
      parseChoreFilters({ status: "skipped", overdue: "yes", category: "nope" }, categoryIds),
    ).toEqual({ status: "skipped", overdueOnly: false, category: null });
  });
});

describe("choreListWhere", () => {
  it("scopes the default filters to the household and pending", () => {
    expect(choreListWhere("household_1", DEFAULT_CHORE_FILTERS, now)).toEqual({
      householdId: "household_1",
      AND: [{ status: "pending" }],
    });
  });

  it("is just the household scope for status=all with no other filter", () => {
    expect(
      choreListWhere("household_1", { status: "all", overdueOnly: false, category: null }, now),
    ).toEqual({ householdId: "household_1" });
  });

  it("matches nothing for overdue-only with status=completed", () => {
    const where = choreListWhere(
      "household_1",
      { status: "completed", overdueOnly: true, category: null },
      now,
    );
    // Both conditions must hold, and a chore has one status.
    expect(where).toEqual({
      householdId: "household_1",
      AND: [{ status: "completed" }, { status: "pending", dueAt: { lt: now } }],
    });
  });

  it("is pending and due before now for overdue-only with status=all", () => {
    expect(
      choreListWhere("household_1", { status: "all", overdueOnly: true, category: null }, now),
    ).toEqual({
      householdId: "household_1",
      AND: [{ status: "pending", dueAt: { lt: now } }],
    });
  });

  it("combines a status with a category", () => {
    expect(
      choreListWhere(
        "household_1",
        { status: "skipped", overdueOnly: false, category: "cat_kitchen" },
        now,
      ),
    ).toEqual({
      householdId: "household_1",
      AND: [{ status: "skipped" }, { categoryId: "cat_kitchen" }],
    });
  });

  it("matches uncategorised chores for category=none", () => {
    expect(
      choreListWhere("household_1", { status: "all", overdueOnly: false, category: "none" }, now),
    ).toEqual({ householdId: "household_1", AND: [{ categoryId: null }] });
  });
});

describe("myChoresWhere", () => {
  it("is the household's pending chores with an assignee row for the user", () => {
    expect(myChoresWhere("household_1", "user_1")).toEqual({
      householdId: "household_1",
      status: "pending",
      assignees: { some: { userId: "user_1" } },
    });
  });
});

describe("CHORE_LIST_ORDER_BY and choreListInclude", () => {
  it("sorts by due date with undated last, then createdAt, then id", () => {
    expect(CHORE_LIST_ORDER_BY).toEqual([
      { dueAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("loads the category name and assignees with their membership in this household", () => {
    expect(choreListInclude("household_1")).toEqual({
      category: { select: { name: true } },
      assignees: {
        select: {
          userId: true,
          user: {
            select: {
              name: true,
              email: true,
              memberships: { where: { householdId: "household_1" }, select: { id: true } },
            },
          },
        },
      },
    });
  });
});

function assignee(userId: string, name: string | null, email: string, member = true) {
  return { userId, user: { name, email, memberships: member ? [{ id: `m_${userId}` }] : [] } };
}

describe("assigneeLine", () => {
  it("says Unassigned for a fixed chore with nobody", () => {
    expect(assigneeLine({ assignmentMode: "fixed", assignees: [] }, "user_1")).toBe("Unassigned");
  });

  it("says Unclaimed for a claim chore with nobody", () => {
    expect(assigneeLine({ assignmentMode: "claim", assignees: [] }, "user_1")).toBe("Unclaimed");
  });

  it("says Claimed by for a claim chore with an assignee", () => {
    expect(
      assigneeLine(
        { assignmentMode: "claim", assignees: [assignee("user_2", "Bob", "bob@example.com")] },
        "user_1",
      ),
    ).toBe("Claimed by Bob");
  });

  it("marks the viewer with (you)", () => {
    expect(
      assigneeLine(
        {
          assignmentMode: "claim",
          assignees: [assignee("user_1", "Alice", "alice@example.com")],
        },
        "user_1",
      ),
    ).toBe("Claimed by Alice (you)");
  });

  it("lists names in label order, the viewer marked, falling back to email", () => {
    expect(
      assigneeLine(
        {
          assignmentMode: "fixed",
          assignees: [
            assignee("user_3", null, "carol@example.com"),
            assignee("user_2", "bob", "bob@example.com"),
            assignee("user_1", "Alice", "alice@example.com"),
          ],
        },
        "user_1",
      ),
    ).toBe("Assigned to Alice (you), bob, carol@example.com");
  });

  it("falls back to email for an empty name", () => {
    expect(
      assigneeLine(
        { assignmentMode: "fixed", assignees: [assignee("user_2", "", "bob@example.com")] },
        "user_1",
      ),
    ).toBe("Assigned to bob@example.com");
  });

  it("ignores case and accents, and breaks ties by user id", () => {
    expect(
      assigneeLine(
        {
          assignmentMode: "fixed",
          assignees: [
            assignee("user_b", "Émile", "e2@example.com"),
            assignee("user_a", "emile", "e1@example.com"),
            assignee("user_c", "Dana", "d@example.com"),
          ],
        },
        "user_x",
      ),
    ).toBe("Assigned to Dana, emile, Émile");
  });

  it("labels someone with no membership here as a former member", () => {
    expect(
      assigneeLine(
        {
          assignmentMode: "fixed",
          assignees: [
            assignee("user_2", "Bob", "bob@example.com", false),
            assignee("user_1", "Alice", "alice@example.com"),
          ],
        },
        "user_1",
      ),
    ).toBe("Assigned to Alice (you), Bob (former member)");
  });
});
