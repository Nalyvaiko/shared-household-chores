import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHORE_CATEGORY_GONE_ERROR } from "@/app/chores/new/messages";
import {
  CHORE_EFFORT_ERROR,
  CHORE_PRIORITY_ERROR,
  CHORE_TITLE_CONTROL_ERROR,
  CHORE_TITLE_EMPTY_ERROR,
  CHORE_TITLE_TOO_LONG_ERROR,
  DUE_AT_INVALID_ERROR,
  DUE_AT_RANGE_ERROR,
  DUE_AT_TIME_ZONE_ERROR,
} from "@/lib/chore/validation";

// The action resolves the caller through the real `requireHousehold()` guard,
// so the session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
const categoryFindUnique = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  membership: { findUnique: vi.fn() },
  category: { findUnique: vi.fn() },
  chore: { create: vi.fn() },
  choreAssignee: { create: vi.fn(), createMany: vi.fn() },
};
const $transaction = vi.fn(async (callback: (client: typeof tx) => unknown) =>
  callback(tx),
);
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique },
    membership: { findFirst },
    category: { findUnique: categoryFindUnique },
    $transaction,
  },
}));

// Like the real one, `redirect` throws so the action stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { createChore } = await import("./actions");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: "Alice" };
const household = { id: "household_1", name: "Home" };
const membership = {
  id: "membership_1",
  userId: "user_1",
  householdId: "household_1",
  role: "member",
  createdAt: new Date("2026-01-01"),
};
const kitchen = { id: "cat_kitchen", name: "Kitchen", builtIn: true, householdId: "household_1" };
const otherHouseholds = { id: "cat_other", name: "Garden", builtIn: false, householdId: "household_9" };

const initial = {
  values: { title: "", dueAtLocal: "", priority: "medium", effort: "medium", categoryId: "" },
};

const valid = {
  title: "Take out the bins",
  dueAtLocal: "",
  dueAt: "",
  priority: "medium",
  effort: "medium",
  categoryId: "",
};

function form(fields: Record<string, string | undefined> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...valid, ...fields })) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

function categoryLookup(row: typeof kitchen | null) {
  tx.category.findUnique.mockResolvedValue(row);
  categoryFindUnique.mockResolvedValue(row);
}

function expectNothingSaved() {
  expect(tx.chore.create).not.toHaveBeenCalled();
  expect(tx.choreAssignee.create).not.toHaveBeenCalled();
  expect(tx.choreAssignee.createMany).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue({ ...membership, household });
  $transaction.mockClear();
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "household_1" }]);
  tx.membership.findUnique.mockReset().mockResolvedValue(membership);
  tx.category.findUnique.mockReset().mockResolvedValue(kitchen);
  categoryFindUnique.mockReset().mockResolvedValue(kitchen);
  tx.chore.create.mockReset().mockResolvedValue({ id: "chore_1" });
  tx.choreAssignee.create.mockReset();
  tx.choreAssignee.createMany.mockReset();
  redirect.mockClear();
  revalidatePath.mockClear();
});

describe("createChore: saving", () => {
  it("creates one pending, unassigned chore with the defaults and redirects to /chores", async () => {
    await expect(
      createChore(
        initial,
        form({
          title: "  Take  out the bins  ",
          dueAtLocal: "2026-03-10T09:30",
          dueAt: "2026-03-10T07:30:00.000Z",
          priority: "urgent",
          effort: "large",
          categoryId: "cat_kitchen",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /chores");

    expect(tx.chore.create).toHaveBeenCalledTimes(1);
    expect(tx.chore.create).toHaveBeenCalledWith({
      data: {
        householdId: "household_1",
        createdById: "user_1",
        title: "Take  out the bins",
        dueAt: new Date("2026-03-10T07:30:00.000Z"),
        priority: "urgent",
        effort: "large",
        categoryId: "cat_kitchen",
        status: "pending",
        recurrence: "none",
        assignmentMode: "fixed",
      },
    });
    expect(tx.choreAssignee.create).not.toHaveBeenCalled();
    expect(tx.choreAssignee.createMany).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/chores");
    expect(redirect).toHaveBeenCalledWith("/chores");
    // After the transaction, not inside it.
    expect(redirect.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.chore.create.mock.invocationCallOrder[0],
    );
  });

  it("saves no due date and no category when both are left empty", async () => {
    await expect(createChore(initial, form())).rejects.toThrow("NEXT_REDIRECT /chores");

    expect(tx.chore.create.mock.calls[0][0].data).toMatchObject({ dueAt: null, categoryId: null });
    expect(tx.category.findUnique).not.toHaveBeenCalled();
  });

  it("accepts a past due date", async () => {
    await expect(
      createChore(
        initial,
        form({ dueAtLocal: "2020-01-01T08:00", dueAt: "2020-01-01T08:00:00.000Z" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /chores");

    expect(tx.chore.create.mock.calls[0][0].data.dueAt).toEqual(new Date("2020-01-01T08:00:00.000Z"));
  });

  it("accepts a 120-emoji title", async () => {
    await expect(createChore(initial, form({ title: "🧹".repeat(120) }))).rejects.toThrow(
      "NEXT_REDIRECT /chores",
    );
    expect(tx.chore.create.mock.calls[0][0].data.title).toBe("🧹".repeat(120));
  });

  it("locks the household row, re-reads the caller, then checks the category, then inserts", async () => {
    await expect(createChore(initial, form({ categoryId: "cat_kitchen" }))).rejects.toThrow(
      "NEXT_REDIRECT /chores",
    );

    expect($transaction).toHaveBeenCalledTimes(1);
    const [strings, ...params] = tx.$queryRaw.mock.calls[0];
    expect(strings.join("?")).toMatch(/SELECT id FROM "Household" WHERE id = \? FOR UPDATE/);
    expect(params).toEqual(["household_1"]);
    expect(tx.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_householdId: { userId: "user_1", householdId: "household_1" } },
    });
    expect(tx.category.findUnique).toHaveBeenCalledWith({ where: { id: "cat_kitchen" } });

    const order = [
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.membership.findUnique.mock.invocationCallOrder[0],
      tx.category.findUnique.mock.invocationCallOrder[0],
      tx.chore.create.mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("ignores tampered status, recurrence, assignment, household, creator and assignee fields", async () => {
    await expect(
      createChore(
        initial,
        form({
          status: "completed",
          recurrence: "daily",
          assignmentMode: "claim",
          householdId: "household_9",
          createdById: "user_9",
          assigneeIds: "user_9",
          assigneeId: "user_9",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /chores");

    expect(tx.chore.create.mock.calls[0][0].data).toMatchObject({
      householdId: "household_1",
      createdById: "user_1",
      status: "pending",
      recurrence: "none",
      assignmentMode: "fixed",
    });
    expect(tx.choreAssignee.create).not.toHaveBeenCalled();
    expect(tx.choreAssignee.createMany).not.toHaveBeenCalled();
  });
});

describe("createChore: refusals", () => {
  it.each([
    ["   ", CHORE_TITLE_EMPTY_ERROR],
    [undefined, CHORE_TITLE_EMPTY_ERROR],
    ["Bins\nnow", CHORE_TITLE_CONTROL_ERROR],
    ["Bins\u0085", CHORE_TITLE_CONTROL_ERROR],
    ["🧹".repeat(121), CHORE_TITLE_TOO_LONG_ERROR],
  ])("refuses the title %j and saves nothing", async (title, error) => {
    const state = await createChore(initial, form({ title }));

    expect(state.errors).toEqual({ title: [error] });
    expect(state.values.title).toBe(title ?? "");
    expect($transaction).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it.each(["URGENT", "critical", "", undefined])(
    "refuses the tampered priority %j instead of defaulting it",
    async (priority) => {
      const state = await createChore(initial, form({ priority }));

      expect(state.errors).toEqual({ priority: [CHORE_PRIORITY_ERROR] });
      expect($transaction).not.toHaveBeenCalled();
      expectNothingSaved();
    },
  );

  it.each(["LARGE", "huge", "", undefined])("refuses the tampered effort %j", async (effort) => {
    const state = await createChore(initial, form({ effort }));

    expect(state.errors).toEqual({ effort: [CHORE_EFFORT_ERROR] });
    expectNothingSaved();
  });

  it.each([
    ["garbage", "2026-03-10T09:30", "soon", DUE_AT_INVALID_ERROR],
    ["the invalid marker", "", "invalid", DUE_AT_INVALID_ERROR],
    ["an offset value", "2026-03-10T09:30", "2026-03-10T09:30:00+02:00", DUE_AT_INVALID_ERROR],
    ["year 0001", "0001-03-10T09:30", "0001-03-10T09:30:00.000Z", DUE_AT_RANGE_ERROR],
    ["year 275760", "275760-09-13T00:00", "+275760-09-13T00:00:00.000Z", DUE_AT_RANGE_ERROR],
    ["a typed date with no UTC value", "2026-03-10T09:30", "", DUE_AT_TIME_ZONE_ERROR],
  ])("refuses %s as the due date", async (_label, dueAtLocal, dueAt, error) => {
    const state = await createChore(initial, form({ dueAtLocal, dueAt }));

    expect(state.errors).toEqual({ dueAt: [error] });
    expect(state.values.dueAtLocal).toBe(dueAtLocal);
    expectNothingSaved();
  });

  it("reports every invalid field at once and keeps what was entered", async () => {
    const fields = {
      title: "",
      dueAtLocal: "2026-03-10T09:30",
      dueAt: "",
      priority: "critical",
      effort: "huge",
      categoryId: "cat_other",
    };
    categoryLookup(otherHouseholds);

    const state = await createChore(initial, form(fields));

    expect(state).toEqual({
      values: { title: "", dueAtLocal: fields.dueAtLocal, priority: "critical", effort: "huge", categoryId: "" },
      errors: {
        title: [CHORE_TITLE_EMPTY_ERROR],
        dueAt: [DUE_AT_TIME_ZONE_ERROR],
        priority: [CHORE_PRIORITY_ERROR],
        effort: [CHORE_EFFORT_ERROR],
        categoryId: [CHORE_CATEGORY_GONE_ERROR],
      },
    });
    expect($transaction).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("keeps a valid category choice when only another field is refused", async () => {
    const state = await createChore(initial, form({ title: "", categoryId: "cat_kitchen" }));

    expect(state.values.categoryId).toBe("cat_kitchen");
    expect(state.errors).toEqual({ title: [CHORE_TITLE_EMPTY_ERROR] });
  });

  it.each([
    ["another household's category", otherHouseholds, "cat_other"],
    ["a category id that no longer exists", null, "cat_deleted"],
  ])("refuses %s with the same message and saves nothing", async (_label, row, categoryId) => {
    categoryLookup(row);

    const state = await createChore(initial, form({ categoryId }));

    expect(state).toEqual({
      values: { title: valid.title, dueAtLocal: "", priority: "medium", effort: "medium", categoryId: "" },
      errors: { categoryId: [CHORE_CATEGORY_GONE_ERROR] },
    });
    expect(tx.category.findUnique).toHaveBeenCalledWith({ where: { id: categoryId } });
    expectNothingSaved();
    // So the select re-renders with the current list.
    expect(revalidatePath).toHaveBeenCalledWith("/chores/new");
  });

  it("redirects a caller removed mid-request to /household/new and saves nothing", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(createChore(initial, form({ categoryId: "cat_kitchen" }))).rejects.toThrow(
      "NEXT_REDIRECT /household/new",
    );
    expect(tx.chore.create).not.toHaveBeenCalled();
    expect(tx.category.findUnique).not.toHaveBeenCalled();
    expect(await $transaction.mock.results[0].value).toBe("gone");
    expect(redirect.mock.invocationCallOrder[0]).toBeGreaterThan(
      $transaction.mock.invocationCallOrder[0],
    );
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(createChore(initial, form())).rejects.toThrow("NEXT_REDIRECT /signin");
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects a caller with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(createChore(initial, form())).rejects.toThrow("NEXT_REDIRECT /household/new");
    expect($transaction).not.toHaveBeenCalled();
  });
});
