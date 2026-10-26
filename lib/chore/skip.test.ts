import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { skipChoreInTransaction } from "@/lib/chore/skip";

const NOW = new Date("2026-10-23T12:00:00.000Z");

const tx = {
  $queryRaw: vi.fn(),
  chore: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  skipRecord: { create: vi.fn() },
  completionRecord: { create: vi.fn() },
  choreAssignee: { deleteMany: vi.fn() },
};
const client = tx as unknown as Prisma.TransactionClient;

const input = {
  choreId: "chore_1",
  householdId: "household_1",
  userId: "user_1",
  reason: "Away all week",
  now: NOW,
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
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function expectNothingWritten() {
  expect(tx.chore.update).not.toHaveBeenCalled();
  expect(tx.skipRecord.create).not.toHaveBeenCalled();
  expect(tx.chore.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "chore_1" }]);
  tx.chore.findUnique.mockReset().mockResolvedValue(chore());
  tx.chore.update.mockReset().mockImplementation(({ data }) => Promise.resolve({ ...chore(), ...data }));
  tx.chore.create.mockReset();
  tx.skipRecord.create.mockReset().mockResolvedValue({});
  tx.completionRecord.create.mockReset();
  tx.choreAssignee.deleteMany.mockReset();
});

describe("skipChoreInTransaction", () => {
  it("locks the chore by id and household before reading it", async () => {
    await skipChoreInTransaction(client, input);

    const [strings, ...params] = tx.$queryRaw.mock.calls[0];
    expect(strings.join("?").replace(/\s+/g, " ").trim()).toBe(
      'SELECT id FROM "Chore" WHERE id = ? AND "householdId" = ? FOR UPDATE',
    );
    expect(params).toEqual(["chore_1", "household_1"]);
    expect(tx.chore.findUnique).toHaveBeenCalledWith({ where: { id: "chore_1" } });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.chore.findUnique.mock.invocationCallOrder[0],
    );
  });

  it("marks the chore skipped, then writes the record with the caller, the reason and the given now", async () => {
    const outcome = await skipChoreInTransaction(client, input);

    expect(tx.chore.update).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      data: { status: "skipped" },
    });
    expect(tx.skipRecord.create).toHaveBeenCalledWith({
      data: { choreId: "chore_1", userId: "user_1", reason: "Away all week", skippedAt: NOW },
    });
    expect(tx.chore.update.mock.invocationCallOrder[0]).toBeLessThan(
      tx.skipRecord.create.mock.invocationCallOrder[0],
    );
    expect(outcome).toMatchObject({ kind: "skipped", chore: { title: "Take out bins", status: "skipped" } });
    // Assignee rows stay; nothing is completed.
    expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
    expect(tx.completionRecord.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a fixed chore nobody is assigned to", { assignmentMode: "fixed" }],
    ["an unclaimed claim chore", { assignmentMode: "claim" }],
  ])("skips %s: there is no assignee check", async (_label, overrides) => {
    tx.chore.findUnique.mockResolvedValue(chore(overrides));

    expect((await skipChoreInTransaction(client, { ...input, userId: "user_9" })).kind).toBe("skipped");
    expect(tx.skipRecord.create.mock.calls[0][0].data.userId).toBe("user_9");
  });

  it.each(["daily", "weekly", "monthly"])("creates no next occurrence for a %s chore", async (recurrence) => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ recurrence, dueAt: new Date("2026-10-20T09:30:00.000Z") }),
    );

    expect((await skipChoreInTransaction(client, input)).kind).toBe("skipped");
    expect(tx.chore.create).not.toHaveBeenCalled();
    expect(tx.chore.update).toHaveBeenCalledTimes(1);
  });

  it("never uses completion or the next-due-date math", () => {
    const source = readFileSync(join(process.cwd(), "lib/chore/skip.ts"), "utf8");
    expect(source).not.toMatch(/import[^;]*(complete|recurrence)/);
    expect(source).not.toMatch(/completeChoreInTransaction\s*\(|nextDueAt\s*\(/);
  });

  it.each([
    ["an empty id", { choreId: "" }, null],
    ["an unknown or other household's id (no row locked)", {}, []],
  ])("answers gone for %s", async (_label, overrides, locked) => {
    if (locked) tx.$queryRaw.mockResolvedValue(locked);

    const outcome = await skipChoreInTransaction(client, { ...input, ...overrides });

    expect(outcome).toEqual({ kind: "gone" });
    if (!locked) expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("answers gone if the re-read finds the chore in another household", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ householdId: "household_9" }));

    expect(await skipChoreInTransaction(client, input)).toEqual({ kind: "gone" });
    expectNothingWritten();
  });

  it.each(["completed", "skipped"])("answers not-pending for a %s chore", async (status) => {
    tx.chore.findUnique.mockResolvedValue(chore({ status }));

    expect(await skipChoreInTransaction(client, input)).toEqual({ kind: "not-pending" });
    expectNothingWritten();
  });

  it("rejects when the record insert rejects", async () => {
    tx.skipRecord.create.mockRejectedValue(new Error("insert failed"));

    await expect(skipChoreInTransaction(client, input)).rejects.toThrow("insert failed");
  });
});
