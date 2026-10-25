import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { canComplete, completeChoreInTransaction } from "@/lib/chore/complete";

const NOW = new Date("2026-10-23T12:00:00.000Z");

const tx = {
  $queryRaw: vi.fn(),
  chore: { findUnique: vi.fn(), update: vi.fn() },
  completionRecord: { create: vi.fn() },
};
const client = tx as unknown as Prisma.TransactionClient;

const input = { choreId: "chore_1", householdId: "household_1", userId: "user_1", now: NOW };

function chore(overrides: Record<string, unknown> = {}) {
  return {
    id: "chore_1",
    householdId: "household_1",
    title: "Take out bins",
    status: "pending",
    assignmentMode: "fixed",
    assignees: [{ userId: "user_1" }],
    ...overrides,
  };
}

function expectNothingWritten() {
  expect(tx.chore.update).not.toHaveBeenCalled();
  expect(tx.completionRecord.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "chore_1" }]);
  tx.chore.findUnique.mockReset().mockResolvedValue(chore());
  tx.chore.update.mockReset().mockImplementation(({ data }) =>
    Promise.resolve({ ...chore(), ...data, assignees: undefined }),
  );
  tx.completionRecord.create.mockReset().mockResolvedValue({});
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
