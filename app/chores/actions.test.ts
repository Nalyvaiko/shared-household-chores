import { AsyncLocalStorage } from "node:async_hooks";

import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHORE_CLAIMED_BY_OTHER_ERROR,
  CHORE_CLAIMED_BY_YOU_ERROR,
  CHORE_GONE_ERROR,
  CHORE_NOT_ASSIGNEE_ERROR,
  CHORE_NOT_CLAIM_ERROR,
  CHORE_NOT_CLAIMANT_ERROR,
  CHORE_NOT_PENDING_ERROR,
  CHORE_UNCLAIMED_ERROR,
} from "@/app/chores/messages";
import {
  SKIP_REASON_CONTROL_ERROR,
  SKIP_REASON_EMPTY_ERROR,
  SKIP_REASON_TOO_LONG_ERROR,
} from "@/lib/chore/validation";

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
  skipRecord: { create: vi.fn() },
  choreAssignee: { create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
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

const { claimChore, completeChore, releaseChore, skipChore } = await import("./actions");

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
  expect(tx.skipRecord.create).not.toHaveBeenCalled();
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
  // Reset to the shared `tx`: the race tests swap in an in-memory store.
  $transaction.mockReset().mockImplementation(async (callback) => callback(tx));
  tx.$queryRaw.mockReset().mockImplementation((strings: string[]) =>
    Promise.resolve(strings.join("").includes('"Chore"') ? [{ id: "chore_1" }] : [{ id: "household_1" }]),
  );
  tx.membership.findUnique.mockReset().mockResolvedValue(membership);
  tx.chore.findUnique.mockReset().mockResolvedValue(chore());
  tx.chore.update
    .mockReset()
    .mockImplementation(({ data }) => Promise.resolve({ ...chore(), assignees: undefined, ...data }));
  tx.completionRecord.create.mockReset().mockResolvedValue({ id: "record_1" });
  tx.skipRecord.create.mockReset().mockResolvedValue({ id: "skip_1" });
  tx.chore.create.mockReset().mockResolvedValue({ id: "chore_2" });
  tx.choreAssignee.create.mockReset().mockResolvedValue({ id: "assignee_1" });
  tx.choreAssignee.delete.mockReset().mockResolvedValue({ id: "assignee_1" });
  tx.choreAssignee.deleteMany.mockReset().mockResolvedValue({ count: 0 });
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

describe("skipChore", () => {
  const skipForm = (fields: Record<string, string> = {}) =>
    form({ choreId: "chore_1", reason: "Away all week", ...fields });

  it("lets a member skip the chore in one transaction and revalidates both lists", async () => {
    const result = await skipChore(idle, skipForm());

    expect(result).toEqual({ status: "success", message: 'Skipped "Take out bins".' });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: { status: "skipped" },
    });
    expect(tx.skipRecord.create).toHaveBeenCalledWith({
      data: { choreId: "chore_1", userId: "user_1", reason: "Away all week", skippedAt: NOW },
    });
    expect(tx.completionRecord.create).not.toHaveBeenCalled();
    expect(tx.chore.create).not.toHaveBeenCalled();
    expectListsRevalidated();
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.skipRecord.create.mock.invocationCallOrder[0],
    );
  });

  it("stores the normalised reason: CRLF to LF, ends trimmed, inner lines kept", async () => {
    await skipChore(idle, skipForm({ reason: "\r\n  Away\r\nall\rweek \r\n" }));

    expect(tx.skipRecord.create.mock.calls[0][0].data.reason).toBe("Away\nall\nweek");
  });

  it("uses the time captured when the action starts", async () => {
    tx.membership.findUnique.mockImplementation(async () => {
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      return membership;
    });

    await skipChore(idle, skipForm());

    expect(tx.skipRecord.create.mock.calls[0][0].data.skippedAt).toEqual(NOW);
  });

  it.each([
    ["an empty reason", "", SKIP_REASON_EMPTY_ERROR],
    ["a whitespace-only reason", "   ", SKIP_REASON_EMPTY_ERROR],
    ["a newline-only reason", "\r\n\n", SKIP_REASON_EMPTY_ERROR],
    ["a tab", "Away\tall week", SKIP_REASON_CONTROL_ERROR],
    ["501 code points", "🧹".repeat(501), SKIP_REASON_TOO_LONG_ERROR],
  ])("refuses %s before any database work and echoes it back", async (_label, reason, message) => {
    expect(await skipChore(idle, skipForm({ reason }))).toEqual({
      status: "error",
      message,
      skipDraft: { choreId: "chore_1", reason },
    });
    expect($transaction).not.toHaveBeenCalled();
    expectNothingWritten();
    expectListsRevalidated();
  });

  it("accepts exactly 500 code points", async () => {
    expect((await skipChore(idle, skipForm({ reason: "🧹".repeat(500) }))).status).toBe("success");
  });

  it.each([
    ["missing", form({ choreId: "chore_1" })],
    [
      "a file",
      (() => {
        const data = form({ choreId: "chore_1" });
        data.set("reason", new Blob(["Away"]), "reason.txt");
        return data;
      })(),
    ],
  ])("treats a %s reason as empty", async (_label, data) => {
    expect(await skipChore(idle, data)).toEqual({
      status: "error",
      message: SKIP_REASON_EMPTY_ERROR,
      skipDraft: { choreId: "chore_1", reason: "" },
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("checks the reason before the chore id", async () => {
    expect(await skipChore(idle, form({ choreId: "", reason: " " }))).toMatchObject({
      status: "error",
      message: SKIP_REASON_EMPTY_ERROR,
    });
  });

  it.each([
    ["an unassigned fixed chore", "member", { assignees: [] }],
    ["an unclaimed claim chore", "member", { assignmentMode: "claim", assignees: [] }],
    ["someone else's chore", "member", { assignees: [{ userId: "user_2" }] }],
    ["a chore claimed by someone else", "member", { assignmentMode: "claim", assignees: [{ userId: "user_2" }] }],
    ["a former member's chore", "admin", { assignees: [{ userId: "user_removed" }] }],
  ])("lets anyone skip %s (%s)", async (_label, role, overrides) => {
    findFirst.mockResolvedValue({ ...membership, role, household });
    tx.membership.findUnique.mockResolvedValue({ ...membership, role });
    tx.chore.findUnique.mockResolvedValue(chore(overrides));

    expect(await skipChore(idle, skipForm())).toEqual({
      status: "success",
      message: 'Skipped "Take out bins".',
    });
    expect(tx.skipRecord.create.mock.calls[0][0].data.userId).toBe("user_1");
  });

  it.each(["daily", "weekly", "monthly"])("creates no next occurrence for a %s chore", async (recurrence) => {
    tx.chore.findUnique.mockResolvedValue(chore({ recurrence, dueAt: new Date("2026-10-20T09:00:00.000Z") }));

    expect((await skipChore(idle, skipForm())).status).toBe("success");
    expect(tx.chore.create).not.toHaveBeenCalled();
    expect(tx.completionRecord.create).not.toHaveBeenCalled();
  });

  it.each(["completed", "skipped"])("refuses a %s chore", async (status) => {
    tx.chore.findUnique.mockResolvedValue(chore({ status }));

    expect(await skipChore(idle, skipForm())).toEqual({
      status: "error",
      message: CHORE_NOT_PENDING_ERROR,
    });
    expectNothingWritten();
    expectListsRevalidated();
  });

  it.each([
    ["an empty id", { choreId: "" }, true],
    ["an unknown id", { choreId: "chore_unknown" }, false],
    ["another household's id", { choreId: "chore_other" }, false],
  ])("answers %s with the same no-longer-exists message", async (_label, fields, skipsLock) => {
    tx.$queryRaw.mockImplementation((strings: string[]) =>
      Promise.resolve(strings.join("").includes('"Chore"') ? [] : [{ id: "household_1" }]),
    );

    expect(await skipChore(idle, skipForm(fields))).toEqual({
      status: "error",
      message: CHORE_GONE_ERROR,
    });
    expect(lockQueries()).toHaveLength(skipsLock ? 1 : 2);
    if (!skipsLock) expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([fields.choreId, "household_1"]);
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
    expectListsRevalidated();
  });

  it("maps a P2002 from the record insert to the not-pending message", async () => {
    tx.skipRecord.create.mockRejectedValue(p2002());

    expect(await skipChore(idle, skipForm())).toEqual({
      status: "error",
      message: CHORE_NOT_PENDING_ERROR,
    });
    expectListsRevalidated();
  });

  it("rethrows any other error", async () => {
    tx.skipRecord.create.mockRejectedValue(new Error("connection lost"));

    await expect(skipChore(idle, skipForm())).rejects.toThrow("connection lost");
  });

  it("redirects a caller removed mid-request to /household/new with nothing written", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(skipChore(idle, skipForm())).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidatePath).not.toHaveBeenCalledWith("/chores");
    expect(lockQueries()).toHaveLength(1);
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("takes the Household lock and re-reads the caller before the Chore lock", async () => {
    await skipChore(idle, skipForm());

    expect(lockQueries()).toEqual([
      'SELECT id FROM "Household" WHERE id = ? FOR UPDATE',
      'SELECT id FROM "Chore" WHERE id = ? AND "householdId" = ? FOR UPDATE',
    ]);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["household_1"]);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["chore_1", "household_1"]);
    const order = [
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.membership.findUnique.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[1],
      tx.chore.findUnique.mock.invocationCallOrder[0],
      tx.chore.update.mock.invocationCallOrder[0],
      tx.skipRecord.create.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("ignores extra posted fields", async () => {
    await skipChore(
      idle,
      skipForm({
        status: "completed",
        userId: "user_2",
        skippedAt: "2001-01-01T00:00:00.000Z",
        householdId: "household_9",
      }),
    );

    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["chore_1", "household_1"]);
    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: { status: "skipped" },
    });
    expect(tx.skipRecord.create).toHaveBeenCalledWith({
      data: { choreId: "chore_1", userId: "user_1", reason: "Away all week", skippedAt: NOW },
    });
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(skipChore(idle, skipForm())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects a caller with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(skipChore(idle, skipForm())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("racing Skip and Complete on one chore", () => {
  // A small in-memory database behind the real actions. Each transaction gets
  // its own client; the Household FOR UPDATE is a lock held until the
  // transaction ends, as in Postgres, and both record tables enforce their
  // unique `choreId`.
  type Row = ReturnType<typeof chore>;
  let chores: Map<string, Row>;
  let completionRecords: { choreId: string; userId: string }[];
  let skipRecords: { choreId: string; userId: string; reason: string }[];
  let householdLock: boolean;

  function useStore(initial: Row) {
    chores = new Map([[initial.id, initial]]);
    completionRecords = [];
    skipRecords = [];
    let held: Promise<void> = Promise.resolve();

    $transaction.mockImplementation(async (callback) => {
      let release = () => {};
      const insertOnce =
        <T extends { choreId: string }>(records: T[]) =>
        async ({ data }: { data: T }) => {
          if (records.some((r) => r.choreId === data.choreId)) throw p2002();
          records.push(data);
          return data;
        };
      const client = {
        $queryRaw: async (strings: string[], ...params: string[]) => {
          if (strings.join("").includes('"Household"')) {
            if (householdLock) {
              const previous = held;
              held = new Promise((resolve) => (release = resolve));
              await previous;
            }
            return [{ id: "household_1" }];
          }
          const row = chores.get(params[0]);
          return row && row.householdId === params[1] ? [{ id: row.id }] : [];
        },
        membership: { findUnique: async () => membership },
        chore: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            const row = chores.get(where.id);
            return row ? { ...row } : null;
          },
          update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
            const row = { ...chores.get(where.id)!, ...data };
            chores.set(row.id, row);
            return row;
          },
          create: async ({ data }: { data: Row }) => {
            const row = { ...chore(), ...data, id: `chore_${chores.size + 1}`, assignees: [] };
            chores.set(row.id, row);
            return row;
          },
        },
        completionRecord: { create: insertOnce(completionRecords) },
        skipRecord: { create: insertOnce(skipRecords) },
      };
      try {
        return await callback(client as unknown as typeof tx);
      } finally {
        release();
      }
    });
  }

  beforeEach(() => {
    householdLock = true;
  });

  it("leaves exactly one SkipRecord after five parallel skips; the others get not-pending", async () => {
    useStore(chore());

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => skipChore(idle, form({ choreId: "chore_1", reason: `Try ${i}` }))),
    );

    expect(results.filter((r) => r.status === "success")).toEqual([
      { status: "success", message: 'Skipped "Take out bins".' },
    ]);
    expect(results.filter((r) => r.status === "error")).toEqual(
      Array(4).fill({ status: "error", message: CHORE_NOT_PENDING_ERROR }),
    );
    expect(skipRecords).toHaveLength(1);
    expect(chores.get("chore_1")!.status).toBe("skipped");
  });

  it("answers the loser with not-pending through the unique record even without the lock", async () => {
    householdLock = false;
    useStore(chore());

    const results = await Promise.all([
      skipChore(idle, form({ choreId: "chore_1", reason: "One" })),
      skipChore(idle, form({ choreId: "chore_1", reason: "Two" })),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["error", "success"]);
    expect(results.find((r) => r.status === "error")).toEqual({
      status: "error",
      message: CHORE_NOT_PENDING_ERROR,
    });
    expect(skipRecords).toHaveLength(1);
  });

  it.each([
    ["Skip first", "skip"],
    ["Complete first", "complete"],
  ])("lets exactly one of Skip and Complete win on a recurring chore (%s)", async (_label, first) => {
    useStore(chore({ recurrence: "weekly", dueAt: new Date("2026-10-20T09:00:00.000Z") }));
    const skip = () => skipChore(idle, form({ choreId: "chore_1", reason: "Away" }));
    const complete = () => completeChore(idle, form({ choreId: "chore_1" }));

    const [a, b] = await Promise.all(first === "skip" ? [skip(), complete()] : [complete(), skip()]);
    const [skipResult, completeResult] = first === "skip" ? [a, b] : [b, a];

    const original = chores.get("chore_1")!;
    if (first === "skip") {
      expect(skipResult).toEqual({ status: "success", message: 'Skipped "Take out bins".' });
      expect(completeResult).toEqual({ status: "error", message: CHORE_NOT_PENDING_ERROR });
      expect(original.status).toBe("skipped");
      expect(skipRecords).toHaveLength(1);
      expect(completionRecords).toHaveLength(0);
      // No roll-over occurrence.
      expect(chores.size).toBe(1);
    } else {
      expect(completeResult).toEqual({ status: "success", message: 'Completed "Take out bins".' });
      expect(skipResult).toEqual({ status: "error", message: CHORE_NOT_PENDING_ERROR });
      expect(original.status).toBe("completed");
      expect(completionRecords).toHaveLength(1);
      expect(skipRecords).toHaveLength(0);
      // The completion rolled over; the skip did nothing.
      expect(chores.size).toBe(2);
    }
  });
});

/** An assignee as `lib/chore/claim.ts` reads it: with their memberships in this household. */
const holder = (userId: string, isMember = true) => ({
  userId,
  user: { memberships: isMember ? [{ id: `membership_${userId}` }] : [] },
});

function expectNoAssigneeWrites() {
  expect(tx.choreAssignee.create).not.toHaveBeenCalled();
  expect(tx.choreAssignee.delete).not.toHaveBeenCalled();
  expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
  expectNothingWritten();
}

describe.each([
  ["claimChore", () => claimChore, chore({ assignmentMode: "claim", assignees: [] })],
  ["releaseChore", () => releaseChore, chore({ assignmentMode: "claim", assignees: [holder("user_1")] })],
] as const)("%s, shared behaviour", (_name, action, claimable) => {
  beforeEach(() => {
    tx.chore.findUnique.mockResolvedValue(claimable);
  });

  it("takes the Household lock, re-reads the caller, then locks and re-reads the chore before writing", async () => {
    await action()(idle, form());

    expect(lockQueries()).toEqual([
      'SELECT id FROM "Household" WHERE id = ? FOR UPDATE',
      'SELECT id FROM "Chore" WHERE id = ? AND "householdId" = ? FOR UPDATE',
    ]);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["household_1"]);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["chore_1", "household_1"]);
    expect(tx.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_householdId: { userId: "user_1", householdId: "household_1" } },
    });
    // The assignees are re-read with their memberships in this household.
    expect(tx.chore.findUnique.mock.calls[0][0].include.assignees.select.user.select.memberships).toEqual({
      where: { householdId: "household_1" },
      select: { id: true },
    });
    const write = [...tx.choreAssignee.create.mock.invocationCallOrder, ...tx.choreAssignee.delete.mock.invocationCallOrder];
    expect(write).toHaveLength(1);
    const order = [
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.membership.findUnique.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[1],
      tx.chore.findUnique.mock.invocationCallOrder[0],
      write[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeGreaterThan(write[0]);
    expectListsRevalidated();
  });

  it("redirects a caller removed mid-request to /household/new with nothing written", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(action()(idle, form())).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidatePath).not.toHaveBeenCalledWith("/chores");
    expect(lockQueries()).toHaveLength(1);
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNoAssigneeWrites();
  });

  it.each([
    ["an empty id", { choreId: "" }, true],
    ["a missing id", {}, true],
    ["an unknown id", { choreId: "chore_unknown" }, false],
    ["another household's id", { choreId: "chore_other" }, false],
  ])("answers %s with the same no-longer-exists message", async (_label, fields, skipsLock) => {
    tx.$queryRaw.mockImplementation((strings: string[]) =>
      Promise.resolve(strings.join("").includes('"Chore"') ? [] : [{ id: "household_1" }]),
    );

    expect(await action()(idle, form(fields))).toEqual({ status: "error", message: CHORE_GONE_ERROR });
    expect(lockQueries()).toHaveLength(skipsLock ? 1 : 2);
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNoAssigneeWrites();
    expectListsRevalidated();
  });

  it.each(["completed", "skipped"])("refuses a %s chore", async (status) => {
    tx.chore.findUnique.mockResolvedValue({ ...claimable, status });

    expect(await action()(idle, form())).toEqual({ status: "error", message: CHORE_NOT_PENDING_ERROR });
    expectNoAssigneeWrites();
    expectListsRevalidated();
  });

  it("refuses a fixed chore", async () => {
    tx.chore.findUnique.mockResolvedValue({ ...claimable, assignmentMode: "fixed" });

    expect(await action()(idle, form())).toEqual({ status: "error", message: CHORE_NOT_CLAIM_ERROR });
    expectNoAssigneeWrites();
    expectListsRevalidated();
  });

  it("reads only choreId from the form", async () => {
    const posted = form({
      choreId: "chore_1",
      userId: "user_2",
      householdId: "household_9",
      assignmentMode: "claim",
    });
    const get = vi.spyOn(posted, "get");

    await action()(idle, posted);

    expect(get.mock.calls.map(([name]) => name)).toEqual(["choreId"]);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["chore_1", "household_1"]);
    expect(tx.membership.findUnique.mock.calls[0][0].where.userId_householdId.userId).toBe("user_1");
  });

  it("rethrows an error that is not a unique violation", async () => {
    tx.choreAssignee.create.mockRejectedValue(new Error("connection lost"));
    tx.choreAssignee.delete.mockRejectedValue(new Error("connection lost"));

    await expect(action()(idle, form())).rejects.toThrow("connection lost");
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(action()(idle, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("claimChore", () => {
  it("claims an unclaimed chore for the caller and gives the success message", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim", assignees: [] }));

    expect(await claimChore(idle, form())).toEqual({ status: "success", message: 'Claimed "Take out bins".' });
    expect(tx.choreAssignee.create).toHaveBeenCalledWith({ data: { choreId: "chore_1", userId: "user_1" } });
    expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
    expectNothingWritten();
    expectListsRevalidated();
  });

  it("lets an admin claim too", async () => {
    findFirst.mockResolvedValue({ ...membership, role: "admin", household });
    tx.membership.findUnique.mockResolvedValue({ ...membership, role: "admin" });
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim", assignees: [] }));

    expect((await claimChore(idle, form())).status).toBe("success");
  });

  it("replaces a former member's claim with the caller's", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ assignmentMode: "claim", assignees: [holder("user_removed", false)] }),
    );

    expect(await claimChore(idle, form())).toEqual({ status: "success", message: 'Claimed "Take out bins".' });
    expect(tx.choreAssignee.deleteMany).toHaveBeenCalledWith({
      where: { choreId: "chore_1", userId: { in: ["user_removed"] } },
    });
    expect(tx.choreAssignee.create).toHaveBeenCalledWith({ data: { choreId: "chore_1", userId: "user_1" } });
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the caller already holds it", [holder("user_1")], CHORE_CLAIMED_BY_YOU_ERROR],
    ["another member holds it", [holder("user_2")], CHORE_CLAIMED_BY_OTHER_ERROR],
    ["another member holds it next to a former member", [holder("user_9", false), holder("user_2")], CHORE_CLAIMED_BY_OTHER_ERROR],
  ])("refuses when %s", async (_label, assignees, message) => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim", assignees }));

    expect(await claimChore(idle, form())).toEqual({ status: "error", message });
    expectNoAssigneeWrites();
    expectListsRevalidated();
  });

  it("maps a P2002 from the insert to the already-claimed-by-you message", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim", assignees: [] }));
    tx.choreAssignee.create.mockRejectedValue(p2002());

    expect(await claimChore(idle, form())).toEqual({ status: "error", message: CHORE_CLAIMED_BY_YOU_ERROR });
    expectListsRevalidated();
  });
});

describe("releaseChore", () => {
  it("deletes only the caller's row and gives the success message", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ assignmentMode: "claim", assignees: [holder("user_2"), holder("user_1")] }),
    );

    expect(await releaseChore(idle, form())).toEqual({ status: "success", message: 'Released "Take out bins".' });
    expect(tx.choreAssignee.delete).toHaveBeenCalledTimes(1);
    expect(tx.choreAssignee.delete).toHaveBeenCalledWith({
      where: { choreId_userId: { choreId: "chore_1", userId: "user_1" } },
    });
    expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
    expect(tx.choreAssignee.create).not.toHaveBeenCalled();
    expectNothingWritten();
    expectListsRevalidated();
  });

  it.each([
    ["unclaimed", []],
    ["claimed by someone else", [holder("user_2")]],
    ["claimed only by a former member", [holder("user_9", false)]],
  ])("refuses a chore that is %s", async (_label, assignees) => {
    findFirst.mockResolvedValue({ ...membership, role: "admin", household });
    tx.membership.findUnique.mockResolvedValue({ ...membership, role: "admin" });
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim", assignees }));

    expect(await releaseChore(idle, form())).toEqual({ status: "error", message: CHORE_NOT_CLAIMANT_ERROR });
    expectNoAssigneeWrites();
    expectListsRevalidated();
  });
});

describe("racing claims, releases and completions on one chore", () => {
  // A small in-memory database behind the real actions, as for Skip above,
  // with assignee rows enforcing their (choreId, userId) unique. Each request
  // runs as its own user, through the session in `requestUser`.
  type Row = ReturnType<typeof chore>;
  const requestUser = new AsyncLocalStorage<string>();
  let chores: Map<string, Row>;
  let assignees: { choreId: string; userId: string }[];
  let members: Set<string>;
  let completionRecords: { choreId: string; userId: string }[];

  function useStore(initial: Row, initialAssignees: string[], memberIds: string[]) {
    chores = new Map([[initial.id, initial]]);
    assignees = initialAssignees.map((userId) => ({ choreId: initial.id, userId }));
    members = new Set(memberIds);
    completionRecords = [];
    let held: Promise<void> = Promise.resolve();

    auth.mockImplementation(async () => {
      const id = requestUser.getStore()!;
      return { user: { id, email: `${id}@example.com` }, expires: "2099-01-01" };
    });
    findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      email: `${where.id}@example.com`,
      name: where.id,
    }));
    findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      members.has(where.userId) ? { ...membership, userId: where.userId, household } : null,
    );

    $transaction.mockImplementation(async (callback) => {
      let release = () => {};
      const client = {
        $queryRaw: async (strings: string[], ...params: string[]) => {
          if (strings.join("").includes('"Household"')) {
            const previous = held;
            held = new Promise((resolve) => (release = resolve));
            await previous;
            return [{ id: "household_1" }];
          }
          const row = chores.get(params[0]);
          return row && row.householdId === params[1] ? [{ id: row.id }] : [];
        },
        membership: {
          findUnique: async ({ where }: { where: { userId_householdId: { userId: string } } }) =>
            members.has(where.userId_householdId.userId) ? membership : null,
        },
        chore: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            const row = chores.get(where.id);
            if (!row) return null;
            const rows = assignees.filter((a) => a.choreId === row.id);
            // Read like the real queries: with memberships for claim, bare for complete.
            return {
              ...row,
              assignees: rows.map((a) => ({
                userId: a.userId,
                user: { memberships: members.has(a.userId) ? [{ id: `m_${a.userId}` }] : [] },
              })),
            };
          },
          update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
            const row = { ...chores.get(where.id)!, ...data };
            chores.set(row.id, row);
            return row;
          },
          create: async ({ data }: { data: Row }) => {
            const row = { ...chore(), ...data, id: `chore_${chores.size + 1}`, assignees: [] };
            chores.set(row.id, row);
            return row;
          },
        },
        choreAssignee: {
          create: async ({ data }: { data: { choreId: string; userId: string } }) => {
            if (assignees.some((a) => a.choreId === data.choreId && a.userId === data.userId)) throw p2002();
            assignees.push(data);
            return data;
          },
          delete: async ({ where }: { where: { choreId_userId: { choreId: string; userId: string } } }) => {
            const { choreId, userId } = where.choreId_userId;
            assignees = assignees.filter((a) => !(a.choreId === choreId && a.userId === userId));
            return {};
          },
          deleteMany: async ({ where }: { where: { choreId: string; userId: { in: string[] } } }) => {
            const before = assignees.length;
            assignees = assignees.filter((a) => !(a.choreId === where.choreId && where.userId.in.includes(a.userId)));
            return { count: before - assignees.length };
          },
        },
        completionRecord: {
          create: async ({ data }: { data: { choreId: string; userId: string } }) => {
            if (completionRecords.some((r) => r.choreId === data.choreId)) throw p2002();
            completionRecords.push(data);
            return data;
          },
        },
        skipRecord: { create: async () => ({}) },
      };
      try {
        return await callback(client as unknown as typeof tx);
      } finally {
        release();
      }
    });
  }

  const as = <T,>(userId: string, run: () => Promise<T>) => requestUser.run(userId, run);
  const post = () => form({ choreId: "chore_1" });

  it("leaves exactly one row when five members claim at once; the others are told someone else has it", async () => {
    const users = ["user_1", "user_2", "user_3", "user_4", "user_5"];
    useStore(chore({ assignmentMode: "claim" }), [], users);

    const results = await Promise.all(users.map((u) => as(u, () => claimChore(idle, post()))));

    expect(results.filter((r) => r.status === "success")).toEqual([
      { status: "success", message: 'Claimed "Take out bins".' },
    ]);
    expect(results.filter((r) => r.status === "error")).toEqual(
      Array(4).fill({ status: "error", message: CHORE_CLAIMED_BY_OTHER_ERROR }),
    );
    expect(assignees).toHaveLength(1);
  });

  it("leaves one row after a double submit by one member; the second is told it is already theirs", async () => {
    useStore(chore({ assignmentMode: "claim" }), [], ["user_1"]);

    const results = await Promise.all([
      as("user_1", () => claimChore(idle, post())),
      as("user_1", () => claimChore(idle, post())),
    ]);

    expect(results).toEqual([
      { status: "success", message: 'Claimed "Take out bins".' },
      { status: "error", message: CHORE_CLAIMED_BY_YOU_ERROR },
    ]);
    expect(assignees).toEqual([{ choreId: "chore_1", userId: "user_1" }]);
  });

  it("replaces a former member's row when two members race to claim it", async () => {
    useStore(chore({ assignmentMode: "claim" }), ["user_gone"], ["user_1", "user_2"]);

    const results = await Promise.all([
      as("user_1", () => claimChore(idle, post())),
      as("user_2", () => claimChore(idle, post())),
    ]);

    expect(results).toEqual([
      { status: "success", message: 'Claimed "Take out bins".' },
      { status: "error", message: CHORE_CLAIMED_BY_OTHER_ERROR },
    ]);
    expect(assignees).toEqual([{ choreId: "chore_1", userId: "user_1" }]);
  });

  it.each([
    ["Release first", "release"],
    ["Complete first", "complete"],
  ])("serializes Release and Complete by the claimant (%s)", async (_label, first) => {
    useStore(chore({ assignmentMode: "claim" }), ["user_1"], ["user_1"]);
    const release = () => as("user_1", () => releaseChore(idle, post()));
    const complete = () => as("user_1", () => completeChore(idle, post()));

    const [a, b] = await Promise.all(first === "release" ? [release(), complete()] : [complete(), release()]);
    const [releaseResult, completeResult] = first === "release" ? [a, b] : [b, a];

    if (first === "release") {
      expect(releaseResult).toEqual({ status: "success", message: 'Released "Take out bins".' });
      expect(completeResult).toEqual({ status: "error", message: CHORE_UNCLAIMED_ERROR });
      expect(chores.get("chore_1")!.status).toBe("pending");
      expect(assignees).toEqual([]);
    } else {
      expect(completeResult).toEqual({ status: "success", message: 'Completed "Take out bins".' });
      expect(releaseResult).toEqual({ status: "error", message: CHORE_NOT_PENDING_ERROR });
      expect(chores.get("chore_1")!.status).toBe("completed");
      expect(assignees).toEqual([{ choreId: "chore_1", userId: "user_1" }]);
    }
  });

  it("refuses a claim after another member's skip with the not-pending message", async () => {
    useStore(chore({ assignmentMode: "claim" }), [], ["user_1", "user_2"]);

    const results = await Promise.all([
      as("user_2", () => skipChore(idle, form({ choreId: "chore_1", reason: "Away" }))),
      as("user_1", () => claimChore(idle, post())),
    ]);

    expect(results).toEqual([
      { status: "success", message: 'Skipped "Take out bins".' },
      { status: "error", message: CHORE_NOT_PENDING_ERROR },
    ]);
    expect(assignees).toEqual([]);
  });

  it("leaves a recurring claim chore's next occurrence unclaimed and claimable", async () => {
    useStore(
      chore({ assignmentMode: "claim", recurrence: "weekly", dueAt: new Date("2026-10-20T09:00:00.000Z") }),
      ["user_1"],
      ["user_1", "user_2"],
    );

    expect((await as("user_1", () => completeChore(idle, post()))).status).toBe("success");
    const next = [...chores.values()].find((row) => row.id !== "chore_1")!;
    expect(next).toMatchObject({ status: "pending", assignmentMode: "claim" });
    expect(assignees.filter((a) => a.choreId === next.id)).toEqual([]);

    expect(await as("user_2", () => claimChore(idle, form({ choreId: next.id })))).toEqual({
      status: "success",
      message: 'Claimed "Take out bins".',
    });
  });
});
