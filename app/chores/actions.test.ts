import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHORE_GONE_ERROR,
  CHORE_NOT_ASSIGNEE_ERROR,
  CHORE_NOT_PENDING_ERROR,
  CHORE_UNCLAIMED_ERROR,
} from "@/app/chores/messages";

// The action resolves the caller through the real `requireHousehold()` guard,
// and runs the real `lib/chore/complete.ts`, so the session and the database
// are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  membership: { findUnique: vi.fn() },
  chore: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  completionRecord: { create: vi.fn() },
};
const $transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique }, membership: { findFirst }, $transaction },
}));

// Like the real one, `redirect` throws so the action stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { completeChore } = await import("./actions");

const NOW = new Date("2026-10-23T12:00:00.000Z");

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

function chore(overrides: Record<string, unknown> = {}) {
  return {
    id: "chore_1",
    householdId: "household_1",
    createdById: "user_2",
    categoryId: null,
    title: "Take out bins",
    dueAt: null,
    priority: "medium",
    effort: "medium",
    status: "pending",
    recurrence: "none",
    assignmentMode: "fixed",
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    assignees: [{ userId: "user_1" }],
    ...overrides,
  };
}

function form(fields: Record<string, string> = { choreId: "chore_1" }): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const idle = { status: "idle" } as const;

/** The SQL of each `$queryRaw` call, placeholders as `?`, whitespace collapsed. */
function lockQueries(): string[] {
  return tx.$queryRaw.mock.calls.map(([strings]) =>
    (strings as string[]).join("?").replace(/\s+/g, " ").trim(),
  );
}

function expectNothingWritten() {
  expect(tx.chore.update).not.toHaveBeenCalled();
  expect(tx.completionRecord.create).not.toHaveBeenCalled();
  expect(tx.chore.create).not.toHaveBeenCalled();
}

function expectListsRevalidated() {
  expect(revalidatePath).toHaveBeenCalledWith("/");
  expect(revalidatePath).toHaveBeenCalledWith("/chores");
  expect(redirect).not.toHaveBeenCalled();
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`choreId`)",
    { code: "P2002", clientVersion: Prisma.prismaVersion.client },
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue({ ...membership, household });
  $transaction.mockClear();
  tx.$queryRaw.mockReset().mockImplementation((strings: string[]) =>
    Promise.resolve(strings.join("").includes('"Chore"') ? [{ id: "chore_1" }] : [{ id: "household_1" }]),
  );
  tx.membership.findUnique.mockReset().mockResolvedValue(membership);
  tx.chore.findUnique.mockReset().mockResolvedValue(chore());
  tx.chore.update
    .mockReset()
    .mockImplementation(({ data }) => Promise.resolve({ ...chore(), assignees: undefined, ...data }));
  tx.completionRecord.create.mockReset().mockResolvedValue({ id: "record_1" });
  tx.chore.create.mockReset().mockResolvedValue({ id: "chore_2" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("completeChore", () => {
  it("lets an assignee complete the chore in one transaction and revalidates both lists", async () => {
    const result = await completeChore(idle, form());

    expect(result).toEqual({ status: "success", message: 'Completed "Take out bins".' });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: { status: "completed" },
    });
    expect(tx.completionRecord.create).toHaveBeenCalledWith({
      data: { choreId: "chore_1", userId: "user_1", completedAt: NOW },
    });
    expectListsRevalidated();
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.completionRecord.create.mock.invocationCallOrder[0],
    );
  });

  it("uses the time captured when the action starts", async () => {
    // The clock moves on while the transaction runs.
    tx.membership.findUnique.mockImplementation(async () => {
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      return membership;
    });

    await completeChore(idle, form());

    expect(tx.completionRecord.create.mock.calls[0][0].data.completedAt).toEqual(NOW);
  });

  it("lets the second-listed assignee of a multi-assignee chore complete it", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ assignees: [{ userId: "user_2" }, { userId: "user_1" }] }),
    );

    expect((await completeChore(idle, form())).status).toBe("success");
    expect(tx.completionRecord.create.mock.calls[0][0].data.userId).toBe("user_1");
  });

  it("lets a claimant complete their claimed chore", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim" }));

    expect((await completeChore(idle, form())).status).toBe("success");
    expect(tx.completionRecord.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an admin who is not assigned", "admin", { assignees: [{ userId: "user_2" }] }],
    ["a member who is not assigned", "member", { assignees: [{ userId: "user_2" }] }],
    ["anyone on a fixed chore with no assignees", "admin", { assignees: [] }],
    [
      "anyone on a claim chore someone else holds",
      "admin",
      { assignmentMode: "claim", assignees: [{ userId: "user_2" }] },
    ],
  ])("refuses %s", async (_label, role, overrides) => {
    findFirst.mockResolvedValue({ ...membership, role, household });
    tx.membership.findUnique.mockResolvedValue({ ...membership, role });
    tx.chore.findUnique.mockResolvedValue(chore(overrides));

    expect(await completeChore(idle, form())).toEqual({
      status: "error",
      message: CHORE_NOT_ASSIGNEE_ERROR,
    });
    expectNothingWritten();
    expectListsRevalidated();
  });

  it("asks for a claim first on a claim chore nobody holds", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim", assignees: [] }));

    expect(await completeChore(idle, form())).toEqual({
      status: "error",
      message: CHORE_UNCLAIMED_ERROR,
    });
    expectNothingWritten();
    expectListsRevalidated();
  });

  it.each(["completed", "skipped"])("refuses a %s chore", async (status) => {
    tx.chore.findUnique.mockResolvedValue(chore({ status }));

    expect(await completeChore(idle, form())).toEqual({
      status: "error",
      message: CHORE_NOT_PENDING_ERROR,
    });
    expectNothingWritten();
    expectListsRevalidated();
  });

  it("refuses the race loser: pending at page load, completed by the time it holds the lock", async () => {
    // The page showed it pending; the in-transaction re-read sees the winner's write.
    tx.chore.findUnique.mockResolvedValue(chore({ status: "completed" }));

    expect(await completeChore(idle, form())).toEqual({
      status: "error",
      message: CHORE_NOT_PENDING_ERROR,
    });
    expect(lockQueries()).toHaveLength(2);
    expectNothingWritten();
  });

  it("maps a P2002 from the record insert to the not-pending message", async () => {
    tx.completionRecord.create.mockRejectedValue(p2002());

    expect(await completeChore(idle, form())).toEqual({
      status: "error",
      message: CHORE_NOT_PENDING_ERROR,
    });
    expectListsRevalidated();
  });

  it("rethrows any other error", async () => {
    tx.completionRecord.create.mockRejectedValue(new Error("connection lost"));

    await expect(completeChore(idle, form())).rejects.toThrow("connection lost");
  });

  it("rejects with the roll-over error when creating the next occurrence fails", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ recurrence: "weekly" }));
    const error = new Error("roll-over insert failed");
    tx.chore.create.mockRejectedValue(error);

    await expect(completeChore(idle, form())).rejects.toBe(error);
    // The completion was attempted in the same transaction, which the throw rolls back.
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.completionRecord.create).toHaveBeenCalledTimes(1);
  });

  it("keeps the success message unchanged for a recurring chore", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ recurrence: "daily" }));

    const result = await completeChore(idle, form());

    expect(result).toEqual({ status: "success", message: 'Completed "Take out bins".' });
    expect(tx.chore.create).toHaveBeenCalledTimes(1);
    expectListsRevalidated();
  });

  it.each([
    ["an empty id", { choreId: "" }, true],
    ["a missing id", {}, true],
    ["an unknown id", { choreId: "chore_unknown" }, false],
    ["another household's id", { choreId: "chore_other" }, false],
  ])("answers %s with the same no-longer-exists message", async (_label, fields, skipsLock) => {
    // The Chore lock is filtered by household, so neither id locks a row.
    tx.$queryRaw.mockImplementation((strings: string[]) =>
      Promise.resolve(strings.join("").includes('"Chore"') ? [] : [{ id: "household_1" }]),
    );

    expect(await completeChore(idle, form(fields))).toEqual({
      status: "error",
      message: CHORE_GONE_ERROR,
    });
    expect(lockQueries()).toHaveLength(skipsLock ? 1 : 2);
    if (!skipsLock) expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([(fields as { choreId: string }).choreId, "household_1"]);
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
    expectListsRevalidated();
  });

  it("treats a file posted as choreId like an empty one", async () => {
    const data = new FormData();
    data.set("choreId", new Blob(["chore_1"]), "chore_1");

    expect(await completeChore(idle, data)).toEqual({ status: "error", message: CHORE_GONE_ERROR });
    expectNothingWritten();
  });

  it("redirects a caller removed mid-request to /household/new with nothing written", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(completeChore(idle, form())).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidatePath).not.toHaveBeenCalledWith("/chores");
    expect(lockQueries()).toHaveLength(1);
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("takes the Household lock and re-reads the caller before the Chore lock", async () => {
    await completeChore(idle, form());

    expect(lockQueries()).toEqual([
      'SELECT id FROM "Household" WHERE id = ? FOR UPDATE',
      'SELECT id FROM "Chore" WHERE id = ? AND "householdId" = ? FOR UPDATE',
    ]);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["household_1"]);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["chore_1", "household_1"]);
    expect(tx.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_householdId: { userId: "user_1", householdId: "household_1" } },
    });
    const order = [
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.membership.findUnique.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[1],
      tx.chore.findUnique.mock.invocationCallOrder[0],
      tx.chore.update.mock.invocationCallOrder[0],
      tx.completionRecord.create.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("ignores extra posted fields", async () => {
    await completeChore(
      idle,
      form({
        choreId: "chore_1",
        status: "skipped",
        userId: "user_2",
        completedAt: "2001-01-01T00:00:00.000Z",
        householdId: "household_9",
      }),
    );

    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["household_1"]);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["chore_1", "household_1"]);
    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: { status: "completed" },
    });
    expect(tx.completionRecord.create).toHaveBeenCalledWith({
      data: { choreId: "chore_1", userId: "user_1", completedAt: NOW },
    });
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(completeChore(idle, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects a caller with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(completeChore(idle, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect($transaction).not.toHaveBeenCalled();
  });
});
