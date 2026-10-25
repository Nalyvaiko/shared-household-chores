import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { canComplete, completeChoreInTransaction } from "@/lib/chore/complete";

const NOW = new Date("2026-10-23T12:00:00.000Z");

const tx = {
  $queryRaw: vi.fn(),
  chore: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  completionRecord: { create: vi.fn() },
};
const client = tx as unknown as Prisma.TransactionClient;

const input = { choreId: "chore_1", householdId: "household_1", userId: "user_1", now: NOW };

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
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    assignees: [{ userId: "user_1" }],
    ...overrides,
  };
}

function expectNothingWritten() {
  expect(tx.chore.update).not.toHaveBeenCalled();
  expect(tx.completionRecord.create).not.toHaveBeenCalled();
  expect(tx.chore.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "chore_1" }]);
  tx.chore.findUnique.mockReset().mockResolvedValue(chore());
  tx.chore.update.mockReset().mockImplementation(({ data }) =>
    Promise.resolve({ ...chore(), ...data, assignees: undefined }),
  );
  tx.completionRecord.create.mockReset().mockResolvedValue({});
  tx.chore.create.mockReset().mockResolvedValue({ id: "chore_2" });
});

describe("completeChoreInTransaction", () => {
  it("locks the chore by id and household, then reads it with its assignees", async () => {
    await completeChoreInTransaction(client, input);

    const [strings, ...params] = tx.$queryRaw.mock.calls[0];
    expect(strings.join("?").replace(/\s+/g, " ").trim()).toBe(
      'SELECT id FROM "Chore" WHERE id = ? AND "householdId" = ? FOR UPDATE',
    );
    expect(params).toEqual(["chore_1", "household_1"]);
    expect(tx.chore.findUnique).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      include: { assignees: { select: { userId: true } } },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.chore.findUnique.mock.invocationCallOrder[0],
    );
  });

  it("marks the chore completed, then writes the record with the caller and the given now", async () => {
    const outcome = await completeChoreInTransaction(client, input);

    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: { status: "completed" },
    });
    expect(tx.completionRecord.create).toHaveBeenCalledWith({
      data: { choreId: "chore_1", userId: "user_1", completedAt: NOW },
    });
    expect(tx.chore.update.mock.invocationCallOrder[0]).toBeLessThan(
      tx.completionRecord.create.mock.invocationCallOrder[0],
    );
    expect(outcome).toMatchObject({ kind: "completed", chore: { title: "Take out bins", status: "completed" } });
  });

  it("lets any one assignee of a multi-assignee chore complete it", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ assignees: [{ userId: "user_2" }, { userId: "user_1" }] }),
    );

    expect((await completeChoreInTransaction(client, input)).kind).toBe("completed");
    expect(tx.completionRecord.create.mock.calls[0][0].data.userId).toBe("user_1");
  });

  it("lets the claimant complete a claim chore", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim" }));

    expect((await completeChoreInTransaction(client, input)).kind).toBe("completed");
  });

  it.each([
    ["an empty id", { choreId: "" }, null],
    ["an unknown or other household's id (no row locked)", {}, []],
  ])("answers gone for %s", async (_label, overrides, locked) => {
    if (locked) tx.$queryRaw.mockResolvedValue(locked);

    const outcome = await completeChoreInTransaction(client, { ...input, ...overrides });

    expect(outcome).toEqual({ kind: "gone" });
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("answers gone if the re-read finds the chore in another household", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ householdId: "household_9" }));

    expect(await completeChoreInTransaction(client, input)).toEqual({ kind: "gone" });
    expectNothingWritten();
  });

  it.each(["completed", "skipped"])("answers not-pending for a %s chore", async (status) => {
    tx.chore.findUnique.mockResolvedValue(chore({ status }));

    expect(await completeChoreInTransaction(client, input)).toEqual({ kind: "not-pending" });
    expectNothingWritten();
  });

  it("checks pending before the assignment", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ status: "completed", assignmentMode: "claim", assignees: [] }),
    );

    expect(await completeChoreInTransaction(client, input)).toEqual({ kind: "not-pending" });
  });

  it("answers unclaimed for a claim chore nobody holds", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "claim", assignees: [] }));

    expect(await completeChoreInTransaction(client, input)).toEqual({ kind: "unclaimed" });
    expectNothingWritten();
  });

  it.each([
    ["a fixed chore assigned to someone else", { assignees: [{ userId: "user_2" }] }],
    ["a fixed chore with nobody assigned", { assignees: [] }],
    ["a claim chore someone else holds", { assignmentMode: "claim", assignees: [{ userId: "user_2" }] }],
  ])("answers not-assignee for %s", async (_label, overrides) => {
    tx.chore.findUnique.mockResolvedValue(chore(overrides));

    expect(await completeChoreInTransaction(client, input)).toEqual({ kind: "not-assignee" });
    expectNothingWritten();
  });
});

describe("completeChoreInTransaction roll-over", () => {
  const recurring = {
    recurrence: "weekly",
    dueAt: new Date("2026-10-20T09:30:00.000Z"),
    categoryId: "category_1",
    priority: "high",
    effort: "small",
  };

  it("creates one pending copy of a recurring fixed chore with the same assignees, after the record", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ ...recurring, assignees: [{ userId: "user_1" }, { userId: "user_removed" }] }),
    );

    const outcome = await completeChoreInTransaction(client, input);

    expect(tx.chore.create).toHaveBeenCalledTimes(1);
    expect(tx.chore.create).toHaveBeenCalledWith({
      data: {
        householdId: "household_1",
        createdById: "user_2",
        title: "Take out bins",
        priority: "high",
        effort: "small",
        categoryId: "category_1",
        assignmentMode: "fixed",
        recurrence: "weekly",
        status: "pending",
        dueAt: new Date("2026-10-27T09:30:00.000Z"),
        assignees: { create: [{ userId: "user_1" }, { userId: "user_removed" }] },
      },
    });
    expect(tx.completionRecord.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.chore.create.mock.invocationCallOrder[0],
    );
    // The original is only marked completed, as before; the outcome is still about it.
    expect(tx.chore.update).toHaveBeenCalledTimes(1);
    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: { status: "completed" },
    });
    expect(outcome).toMatchObject({ kind: "completed", chore: { id: "chore_1", status: "completed" } });
  });

  it("copies a null category and gives a chore without a due date one based on now", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ recurrence: "daily" }));

    await completeChoreInTransaction(client, input);

    const { data } = tx.chore.create.mock.calls[0][0];
    expect(data.categoryId).toBeNull();
    expect(data.dueAt).toEqual(new Date("2026-10-24T12:00:00.000Z"));
  });

  it("creates the copy of a claim chore with no assignees", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ ...recurring, recurrence: "monthly", assignmentMode: "claim" }),
    );

    await completeChoreInTransaction(client, input);

    expect(tx.chore.create).toHaveBeenCalledTimes(1);
    const { data } = tx.chore.create.mock.calls[0][0];
    expect(data).toMatchObject({ assignmentMode: "claim", recurrence: "monthly", status: "pending" });
    expect(data.dueAt).toEqual(new Date("2026-11-20T09:30:00.000Z"));
    expect(data).not.toHaveProperty("assignees");
  });

  it("creates nothing extra for a non-recurring chore", async () => {
    expect((await completeChoreInTransaction(client, input)).kind).toBe("completed");
    expect(tx.chore.create).not.toHaveBeenCalled();
  });

  it.each([
    ["gone (no row locked)", {}, []],
    ["gone (another household)", { householdId: "household_9" }, null],
    ["not-pending", { status: "completed" }, null],
    ["unclaimed", { assignmentMode: "claim", assignees: [] }, null],
    ["not-assignee", { assignees: [{ userId: "user_2" }] }, null],
  ])("creates nothing on a %s refusal", async (_label, overrides, locked) => {
    if (locked) tx.$queryRaw.mockResolvedValue(locked);
    tx.chore.findUnique.mockResolvedValue(chore({ ...recurring, ...overrides }));

    expect((await completeChoreInTransaction(client, input)).kind).not.toBe("completed");
    expectNothingWritten();
  });

  it("rejects when creating the next occurrence rejects", async () => {
    tx.chore.findUnique.mockResolvedValue(chore(recurring));
    tx.chore.create.mockRejectedValue(new Error("insert failed"));

    await expect(completeChoreInTransaction(client, input)).rejects.toThrow("insert failed");
  });
});

describe("canComplete", () => {
  it("is true only for a pending chore with an assignee row for the user", () => {
    const assigned = { status: "pending" as const, assignees: [{ userId: "user_2" }, { userId: "user_1" }] };
    expect(canComplete(assigned, "user_1")).toBe(true);
    expect(canComplete(assigned, "user_3")).toBe(false);
    expect(canComplete({ status: "pending", assignees: [] }, "user_1")).toBe(false);
    expect(canComplete({ ...assigned, status: "completed" }, "user_1")).toBe(false);
    expect(canComplete({ ...assigned, status: "skipped" }, "user_1")).toBe(false);
  });
});
