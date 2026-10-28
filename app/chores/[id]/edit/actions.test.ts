import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHORE_GONE_ERROR, CHORE_NOT_PENDING_ERROR } from "@/app/chores/messages";
import {
  CHORE_ASSIGNEE_GONE_ERROR,
  CHORE_CATEGORY_GONE_ERROR,
} from "@/app/chores/new/messages";
import { ADMIN_ONLY_ERROR } from "@/app/household/members/messages";
import {
  CHORE_ASSIGNMENT_MODE_ERROR,
  CHORE_EFFORT_ERROR,
  CHORE_PRIORITY_ERROR,
  CHORE_RECURRENCE_ERROR,
  CHORE_TITLE_EMPTY_ERROR,
  DUE_AT_INVALID_ERROR,
  DUE_AT_RANGE_ERROR,
  DUE_AT_TIME_ZONE_ERROR,
} from "@/lib/chore/validation";

// The actions resolve the caller through the real guards, so the session and
// the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

/** Every database call, in order, by name. */
let calls: string[];

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const dbMembershipFindMany = vi.fn();
const dbCategoryFindUnique = vi.fn();
const dbChoreFindFirst = vi.fn();

const tx = {
  $queryRaw: vi.fn(),
  membership: { findUnique: vi.fn(), findMany: vi.fn() },
  category: { findUnique: vi.fn() },
  chore: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  choreAssignee: { deleteMany: vi.fn(), createMany: vi.fn() },
};
const $transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => {
  calls.push("transaction");
  return callback(tx);
});
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst, findMany: dbMembershipFindMany },
    category: { findUnique: dbCategoryFindUnique },
    chore: { findFirst: dbChoreFindFirst },
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

const { deleteChore, updateChore } = await import("./actions");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Home" };

function membershipOf(role: "admin" | "member", userId = "user_1") {
  return { id: `membership_${userId}`, userId, householdId: "household_1", role, createdAt: new Date("2026-01-01") };
}

const STORED_DUE = new Date("2026-11-01T09:30:00.000Z");

function storedChore(overrides: Record<string, unknown> = {}) {
  return {
    id: "chore_1",
    householdId: "household_1",
    createdById: "user_2",
    categoryId: null,
    title: "Take out bins",
    dueAt: STORED_DUE,
    priority: "medium",
    effort: "medium",
    status: "pending",
    recurrence: "none",
    assignmentMode: "fixed",
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    assignees: [] as { userId: string }[],
    ...overrides,
  };
}

const kitchen = { id: "cat_kitchen", name: "Kitchen", builtIn: true, householdId: "household_1" };

// Current members of household_1. user_9 is a former member.
let householdMembers: string[];
let caller: ReturnType<typeof membershipOf> | null;
let locked: boolean;
let chore: ReturnType<typeof storedChore> | null;
let category: typeof kitchen | null;

function memberRows({ where }: { where: { householdId: string; userId: { in: string[] } } }) {
  const rows = where.householdId === "household_1" ? householdMembers : [];
  return Promise.resolve(where.userId.in.filter((id) => rows.includes(id)).map((userId) => ({ userId })));
}

const valid = {
  choreId: "chore_1",
  title: "Take out bins",
  dueAtLocal: "",
  dueAt: "unchanged",
  priority: "medium",
  effort: "medium",
  categoryId: "",
  recurrence: "none",
  assignmentMode: "fixed",
};

function form(fields: Record<string, string | string[] | undefined> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...valid, ...fields })) {
    if (Array.isArray(value)) value.forEach((entry) => data.append(key, entry));
    else if (value !== undefined) data.set(key, value);
  }
  return data;
}

const initial = {
  values: {
    title: "",
    dueAtLocal: "",
    priority: "medium",
    effort: "medium",
    categoryId: "",
    recurrence: "none",
    assignmentMode: "fixed",
    assigneeIds: [] as string[],
  },
};

function setSession(role: "admin" | "member") {
  membershipFindFirst.mockResolvedValue({ ...membershipOf(role), household });
  caller = membershipOf(role);
}

beforeEach(() => {
  calls = [];
  householdMembers = ["user_1", "user_2", "user_3"];
  locked = true;
  chore = storedChore();
  category = kitchen;

  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset();
  setSession("member");
  dbMembershipFindMany.mockReset().mockImplementation(memberRows);
  dbCategoryFindUnique.mockReset().mockImplementation(async () => category);
  dbChoreFindFirst.mockReset().mockImplementation(async () => chore);
  $transaction.mockClear();

  tx.$queryRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "Household"')) {
      calls.push("lock household");
      return [{ id: "household_1" }];
    }
    calls.push("lock chore");
    return locked ? [{ id: "chore_1" }] : [];
  });
  tx.membership.findUnique.mockReset().mockImplementation(async () => {
    calls.push("caller");
    return caller;
  });
  tx.membership.findMany.mockReset().mockImplementation((args) => {
    calls.push("members");
    return memberRows(args);
  });
  tx.category.findUnique.mockReset().mockImplementation(async () => {
    calls.push("category");
    return category;
  });
  tx.chore.findUnique.mockReset().mockImplementation(async () => {
    calls.push("chore");
    return chore;
  });
  tx.chore.update.mockReset().mockImplementation(async () => {
    calls.push("update");
    return chore;
  });
  tx.chore.delete.mockReset().mockImplementation(async () => {
    calls.push("delete");
    return chore;
  });
  tx.choreAssignee.deleteMany.mockReset().mockImplementation(async () => {
    calls.push("delete assignees");
    return { count: 0 };
  });
  tx.choreAssignee.createMany.mockReset().mockImplementation(async () => {
    calls.push("insert assignees");
    return { count: 0 };
  });
  redirect.mockClear();
  revalidatePath.mockClear();
});

function expectNothingWritten() {
  expect(tx.chore.update).not.toHaveBeenCalled();
  expect(tx.chore.delete).not.toHaveBeenCalled();
  expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
  expect(tx.choreAssignee.createMany).not.toHaveBeenCalled();
}

async function save(fields: Record<string, string | string[] | undefined> = {}) {
  return updateChore(initial, form(fields));
}

async function expectSaved(fields: Record<string, string | string[] | undefined> = {}) {
  await expect(save(fields)).rejects.toThrow("NEXT_REDIRECT /chores?notice=saved");
}

function updateData() {
  return tx.chore.update.mock.calls[0][0].data;
}

describe("updateChore", () => {
  it("saves a member's edits to every other field and redirects with the saved notice", async () => {
    const dueAt = "2026-12-24T18:00:00.000Z";
    await expectSaved({
      title: "  Hoover the stairs ",
      dueAtLocal: "2026-12-24T19:00",
      dueAt,
      priority: "urgent",
      effort: "large",
      categoryId: "cat_kitchen",
      recurrence: "weekly",
    });

    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: {
        title: "Hoover the stairs",
        dueAt: new Date(dueAt),
        priority: "urgent",
        effort: "large",
        categoryId: "cat_kitchen",
        recurrence: "weekly",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/chores");
    expect(redirect).toHaveBeenCalledWith("/chores?notice=saved");
  });

  it("runs household lock, caller, chore lock, re-read, checks, update, assignee changes in order", async () => {
    setSession("admin");
    chore = storedChore({ assignees: [{ userId: "user_2" }] });

    await expectSaved({ categoryId: "cat_kitchen", assigneeIds: ["user_3"] });

    expect(calls).toEqual([
      "transaction",
      "lock household",
      "caller",
      "lock chore",
      "chore",
      "category",
      "members",
      "update",
      "members",
      "delete assignees",
      "insert assignees",
    ]);
    const lockSql = (tx.$queryRaw.mock.calls[1][0] as TemplateStringsArray).join("?");
    expect(lockSql).toContain('FROM "Chore" WHERE id = ? AND "householdId" = ? FOR UPDATE');
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["chore_1", "household_1"]);
  });

  it("clears the due date when the field is emptied", async () => {
    await expectSaved({ dueAt: "", dueAtLocal: "" });
    expect(updateData().dueAt).toBeNull();
  });

  it("keeps the stored due date for unchanged with an empty field", async () => {
    await expectSaved({ dueAt: "unchanged", dueAtLocal: "" });
    expect(updateData().dueAt).toEqual(STORED_DUE);
  });

  it("refuses unchanged with a typed field (no JavaScript) with the time-zone message", async () => {
    const state = await save({ dueAt: "unchanged", dueAtLocal: "2026-12-01T10:00" });

    expect(state.errors).toEqual({ dueAt: [DUE_AT_TIME_ZONE_ERROR] });
    expect(state.values.dueAtLocal).toBe("2026-12-01T10:00");
    expect($transaction).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("accepts an out-of-range due date equal to the stored one", async () => {
    const stored = new Date("2101-03-01T09:30:00.000Z");
    chore = storedChore({ dueAt: stored });

    await expectSaved({ dueAt: stored.toISOString(), dueAtLocal: "2101-03-01T10:30", title: "Renamed" });
    expect(updateData().dueAt).toEqual(stored);
    expect(updateData().title).toBe("Renamed");
  });

  it("refuses a changed out-of-range due date with the range message", async () => {
    chore = storedChore({ dueAt: new Date("2101-03-01T09:30:00.000Z") });

    const state = await save({ dueAt: "2101-03-02T09:30:00.000Z", dueAtLocal: "2101-03-02T10:30" });
    expect(state.errors).toEqual({ dueAt: [DUE_AT_RANGE_ERROR] });
    expectNothingWritten();
  });

  it("refuses the out-of-range marker even when the stored date is out of range", async () => {
    chore = storedChore({ dueAt: new Date("2101-03-01T09:30:00.000Z") });
    const state = await save({ dueAt: "out-of-range", dueAtLocal: "3000-01-01T00:00" });
    expect(state.errors).toEqual({ dueAt: [DUE_AT_RANGE_ERROR] });
    expectNothingWritten();
  });

  it("reports every invalid field at once with the create messages, without a lock, and echoes", async () => {
    setSession("admin");
    category = null;
    const state = await save({
      title: " ",
      dueAt: "garbage",
      dueAtLocal: "2026-01-01T00:00",
      priority: "",
      effort: "huge",
      recurrence: "yearly",
      assignmentMode: "rota",
      categoryId: "cat_gone",
      assigneeIds: ["user_3", "user_9"],
    });

    expect(state.errors).toEqual({
      title: [CHORE_TITLE_EMPTY_ERROR],
      dueAt: [DUE_AT_INVALID_ERROR],
      priority: [CHORE_PRIORITY_ERROR],
      effort: [CHORE_EFFORT_ERROR],
      recurrence: [CHORE_RECURRENCE_ERROR],
      assignmentMode: [CHORE_ASSIGNMENT_MODE_ERROR],
      categoryId: [CHORE_CATEGORY_GONE_ERROR],
    });
    expect(state.values).toMatchObject({ title: " ", categoryId: "", effort: "huge" });
    expect($transaction).not.toHaveBeenCalled();
    expect(dbChoreFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "chore_1", householdId: "household_1" } }),
    );
    expectNothingWritten();
  });

  it("drops a non-member's tick and reports a gone category alongside a title error, twice in a row", async () => {
    setSession("admin");
    category = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const state = await save({ title: "", categoryId: "cat_gone", assigneeIds: ["user_3", "user_9"] });
      expect(state.errors).toEqual({
        title: [CHORE_TITLE_EMPTY_ERROR],
        categoryId: [CHORE_CATEGORY_GONE_ERROR],
        assigneeIds: [CHORE_ASSIGNEE_GONE_ERROR],
      });
      expect(state.values.categoryId).toBe("");
      expect(state.values.assigneeIds).toEqual(["user_3"]);
    }
    expect(revalidatePath).toHaveBeenCalledWith("/chores/chore_1/edit");
    expectNothingWritten();
  });

  it("refuses a gone category or member found under the lock, writing nothing", async () => {
    setSession("admin");
    category = null;
    const state = await save({ categoryId: "cat_gone", assigneeIds: ["user_9"] });

    expect(state.errors).toEqual({
      categoryId: [CHORE_CATEGORY_GONE_ERROR],
      assigneeIds: [CHORE_ASSIGNEE_GONE_ERROR],
    });
    expect(state.values.assigneeIds).toEqual([]);
    expect(calls).toContain("lock chore");
    expectNothingWritten();
  });

  it("answers a gone chore (unknown, empty or another household's) with the gone message", async () => {
    locked = false;
    expect(await save()).toMatchObject({ formError: CHORE_GONE_ERROR });
    expect(await save({ choreId: "" })).toMatchObject({ formError: CHORE_GONE_ERROR });
    expectNothingWritten();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("answers a gone chore on the unlocked refusal path too", async () => {
    chore = null;
    expect(await save({ title: "" })).toMatchObject({ formError: CHORE_GONE_ERROR });
  });

  it.each(["completed", "skipped"])("refuses a %s chore with the not-pending message", async (status) => {
    chore = storedChore({ status });
    expect(await save()).toMatchObject({ formError: CHORE_NOT_PENDING_ERROR });
    expect(await save({ title: "" })).toMatchObject({ formError: CHORE_NOT_PENDING_ERROR });
    expectNothingWritten();
  });

  it("redirects a caller removed since the page loaded to /household/new", async () => {
    caller = null;
    await expect(save()).rejects.toThrow("NEXT_REDIRECT /household/new");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expectNothingWritten();
  });

  it("ignores posted status, householdId and createdById", async () => {
    await expectSaved({ status: "completed", householdId: "household_9", createdById: "user_1" });
    const data = updateData();
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("householdId");
    expect(data).not.toHaveProperty("createdById");
    expect(tx.chore.update.mock.calls[0][0].where).toEqual({ id: "chore_1" });
  });

  describe("assignment", () => {
    it("ignores a non-creator member's posted mode and ids: no validation, no writes", async () => {
      chore = storedChore({ assignmentMode: "fixed", assignees: [{ userId: "user_2" }] });

      await expectSaved({ assignmentMode: "claim", assigneeIds: ["user_9"] });
      expect(updateData()).not.toHaveProperty("assignmentMode");
      expectNothingWrittenToAssignees();

      await expectSaved({ assignmentMode: "rota" });
      expect(tx.choreAssignee.createMany).not.toHaveBeenCalled();
    });

    it("uses the role re-read under the lock, not the session's", async () => {
      setSession("admin");
      caller = membershipOf("member");
      await expectSaved({ assignmentMode: "claim" });
      expect(updateData()).not.toHaveProperty("assignmentMode");
      expectNothingWrittenToAssignees();
    });

    it("lets the creator change the assignment", async () => {
      chore = storedChore({ createdById: "user_1" });
      await expectSaved({ assignmentMode: "fixed", assigneeIds: ["user_2"] });
      expect(updateData().assignmentMode).toBe("fixed");
      expect(tx.choreAssignee.createMany).toHaveBeenCalledWith({
        data: [{ choreId: "chore_1", userId: "user_2" }],
        skipDuplicates: true,
      });
    });

    it("refuses an invalid mode from someone who may assign", async () => {
      setSession("admin");
      const state = await save({ assignmentMode: "rota" });
      expect(state.errors).toEqual({ assignmentMode: [CHORE_ASSIGNMENT_MODE_ERROR] });
      expectNothingWritten();
    });

    it("Claim → Claim leaves the rows, a former member's claim included", async () => {
      setSession("admin");
      chore = storedChore({ assignmentMode: "claim", assignees: [{ userId: "user_9" }] });
      await expectSaved({ assignmentMode: "claim", assigneeIds: ["user_2"] });
      expect(updateData().assignmentMode).toBe("claim");
      expectNothingWrittenToAssignees();
    });

    it("Fixed → Claim deletes every row", async () => {
      setSession("admin");
      chore = storedChore({ assignees: [{ userId: "user_2" }, { userId: "user_9" }] });
      await expectSaved({ assignmentMode: "claim", assigneeIds: ["user_2"] });
      expect(tx.choreAssignee.deleteMany).toHaveBeenCalledWith({ where: { choreId: "chore_1" } });
      expect(tx.choreAssignee.createMany).not.toHaveBeenCalled();
    });

    it("Claim → Fixed replaces the claim with a row per tick", async () => {
      setSession("admin");
      chore = storedChore({ assignmentMode: "claim", assignees: [{ userId: "user_2" }] });
      await expectSaved({ assignmentMode: "fixed", assigneeIds: ["user_2", "user_3"] });
      expect(tx.choreAssignee.deleteMany).toHaveBeenCalledWith({ where: { choreId: "chore_1" } });
      expect(tx.choreAssignee.createMany).toHaveBeenCalledWith({
        data: [
          { choreId: "chore_1", userId: "user_2" },
          { choreId: "chore_1", userId: "user_3" },
        ],
        skipDuplicates: true,
      });
      expect(calls.indexOf("delete assignees")).toBeLessThan(calls.indexOf("insert assignees"));
    });

    it("Fixed → Fixed deletes only unticked current members, inserts only missing ones, keeps former members", async () => {
      setSession("admin");
      chore = storedChore({
        assignees: [{ userId: "user_1" }, { userId: "user_2" }, { userId: "user_9" }],
      });
      await expectSaved({ assigneeIds: ["user_2", "user_3", "user_3"] });

      expect(tx.choreAssignee.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.choreAssignee.deleteMany).toHaveBeenCalledWith({
        where: { choreId: "chore_1", userId: { in: ["user_1"] } },
      });
      expect(tx.choreAssignee.createMany).toHaveBeenCalledWith({
        data: [{ choreId: "chore_1", userId: "user_3" }],
        skipDuplicates: true,
      });
    });

    it("Fixed → Fixed with the same ticks writes no assignee rows", async () => {
      setSession("admin");
      chore = storedChore({ assignees: [{ userId: "user_2" }, { userId: "user_9" }] });
      await expectSaved({ assigneeIds: ["user_2"] });
      expectNothingWrittenToAssignees();
    });

    it("two identical saves both succeed with the same writes", async () => {
      setSession("admin");
      chore = storedChore({ assignees: [{ userId: "user_2" }] });
      await expectSaved({ assigneeIds: ["user_2"], title: "Same" });
      await expectSaved({ assigneeIds: ["user_2"], title: "Same" });
      expect(tx.chore.update.mock.calls[0]).toEqual(tx.chore.update.mock.calls[1]);
      expectNothingWrittenToAssignees();
    });
  });
});

function expectNothingWrittenToAssignees() {
  expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
  expect(tx.choreAssignee.createMany).not.toHaveBeenCalled();
}

describe("deleteChore", () => {
  async function remove(choreId = "chore_1") {
    const data = new FormData();
    data.set("choreId", choreId);
    return deleteChore({}, data);
  }

  it("refuses a member before opening any transaction", async () => {
    expect(await remove()).toEqual({ error: ADMIN_ONLY_ERROR });
    expect($transaction).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("redirects a signed-out caller through the guard", async () => {
    auth.mockResolvedValue(null);
    await expect(remove()).rejects.toThrow("NEXT_REDIRECT /signin");
  });

  it.each(["pending", "completed", "skipped"])(
    "lets an admin delete a %s chore after both locks, then redirects with the deleted notice",
    async (status) => {
      setSession("admin");
      chore = storedChore({ status });

      await expect(remove()).rejects.toThrow("NEXT_REDIRECT /chores?notice=deleted");
      expect(calls).toEqual(["transaction", "lock household", "caller", "lock chore", "delete"]);
      expect(tx.chore.delete).toHaveBeenCalledWith({ where: { id: "chore_1" } });
      // The children go by cascade; nothing else is deleted explicitly.
      expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledWith("/chores");
    },
  );

  it("answers a gone chore (or a second delete) with the gone message", async () => {
    setSession("admin");
    locked = false;
    expect(await remove()).toEqual({ error: CHORE_GONE_ERROR });
    expect(await remove("")).toEqual({ error: CHORE_GONE_ERROR });
    expectNothingWritten();
    // A revalidation would re-render the edit page as a 404 over the message.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects a caller removed since the page loaded", async () => {
    setSession("admin");
    caller = null;
    await expect(remove()).rejects.toThrow("NEXT_REDIRECT /household/new");
    expectNothingWritten();
  });

  it("refuses a caller who is no longer an admin under the lock", async () => {
    setSession("admin");
    caller = membershipOf("member");
    expect(await remove()).toEqual({ error: ADMIN_ONLY_ERROR });
    expect(calls).not.toContain("lock chore");
    expectNothingWritten();
  });
});
