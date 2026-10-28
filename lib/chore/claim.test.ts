import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canClaim,
  canRelease,
  claimChoreInTransaction,
  releaseChoreInTransaction,
} from "@/lib/chore/claim";

const tx = {
  $queryRaw: vi.fn(),
  chore: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  choreAssignee: { create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  completionRecord: { create: vi.fn() },
  skipRecord: { create: vi.fn() },
};
const client = tx as unknown as Prisma.TransactionClient;

const input = { choreId: "chore_1", householdId: "household_1", userId: "user_1" };

const current = (userId: string) => ({ userId, user: { memberships: [{ id: `m_${userId}` }] } });
const former = (userId: string) => ({ userId, user: { memberships: [] } });

function chore(overrides: Record<string, unknown> = {}) {
  return {
    id: "chore_1",
    householdId: "household_1",
    createdById: "user_2",
    categoryId: null,
    title: "Water the plants",
    dueAt: null,
    priority: "medium",
    effort: "medium",
    status: "pending",
    recurrence: "none",
    assignmentMode: "claim",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    assignees: [] as { userId: string; user: { memberships: unknown[] } }[],
    ...overrides,
  };
}

function expectNothingWritten() {
  expect(tx.choreAssignee.create).not.toHaveBeenCalled();
  expect(tx.choreAssignee.delete).not.toHaveBeenCalled();
  expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
  expect(tx.chore.update).not.toHaveBeenCalled();
  expect(tx.chore.create).not.toHaveBeenCalled();
  expect(tx.completionRecord.create).not.toHaveBeenCalled();
  expect(tx.skipRecord.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "chore_1" }]);
  tx.chore.findUnique.mockReset().mockResolvedValue(chore());
  tx.chore.update.mockReset();
  tx.chore.create.mockReset();
  tx.choreAssignee.create.mockReset().mockResolvedValue({});
  tx.choreAssignee.delete.mockReset().mockResolvedValue({});
  tx.choreAssignee.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  tx.completionRecord.create.mockReset();
  tx.skipRecord.create.mockReset();
});

describe("canClaim", () => {
  it.each([
    ["an unclaimed pending claim chore", {}, true],
    ["a claim chore held only by a former member", { assignees: [former("user_9")] }, true],
    ["a claim chore held only by former members", { assignees: [former("user_8"), former("user_9")] }, true],
    ["a claim chore a current member holds", { assignees: [current("user_2")] }, false],
    ["a claim chore the viewer holds", { assignees: [current("user_1")] }, false],
    ["mixed former and current rows", { assignees: [former("user_9"), current("user_2")] }, false],
    ["several current rows", { assignees: [current("user_1"), current("user_2")] }, false],
    ["a fixed chore with no assignees", { assignmentMode: "fixed" }, false],
    ["a fixed chore held by a former member", { assignmentMode: "fixed", assignees: [former("user_9")] }, false],
    ["a completed claim chore", { status: "completed" }, false],
    ["a skipped claim chore", { status: "skipped" }, false],
  ])("is %s → %s", (_label, overrides, expected) => {
    expect(canClaim(chore(overrides) as Parameters<typeof canClaim>[0])).toBe(expected);
  });
});

describe("canRelease", () => {
  it.each([
    ["the claimant of a pending claim chore", { assignees: [current("user_1")] }, true],
    ["one of several holders", { assignees: [current("user_2"), current("user_1")] }, true],
    ["a holder next to a former member's row", { assignees: [former("user_9"), current("user_1")] }, true],
    ["not a holder: someone else's claim", { assignees: [current("user_2")] }, false],
    ["not a holder: a former member's claim", { assignees: [former("user_9")] }, false],
    ["not a holder: unclaimed", {}, false],
    ["an assignee of a fixed chore", { assignmentMode: "fixed", assignees: [current("user_1")] }, false],
    ["the holder of a completed chore", { status: "completed", assignees: [current("user_1")] }, false],
    ["the holder of a skipped chore", { status: "skipped", assignees: [current("user_1")] }, false],
  ])("is %s → %s", (_label, overrides, expected) => {
    expect(canRelease(chore(overrides) as Parameters<typeof canRelease>[0], "user_1")).toBe(expected);
  });
});

describe.each([
  ["claimChoreInTransaction", claimChoreInTransaction],
  ["releaseChoreInTransaction", releaseChoreInTransaction],
] as const)("%s, shared checks", (_name, run) => {
  it("locks the chore by id and household, then re-reads it with assignees and their memberships here", async () => {
    await run(client, input);

    const [strings, ...params] = tx.$queryRaw.mock.calls[0];
    expect(strings.join("?").replace(/\s+/g, " ").trim()).toBe(
      'SELECT id FROM "Chore" WHERE id = ? AND "householdId" = ? FOR UPDATE',
    );
    expect(params).toEqual(["chore_1", "household_1"]);
    expect(tx.chore.findUnique).toHaveBeenCalledWith({
      where: { id: "chore_1" },
      include: {
        assignees: {
          select: {
            userId: true,
            user: {
              select: { memberships: { where: { householdId: "household_1" }, select: { id: true } } },
            },
          },
        },
      },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.chore.findUnique.mock.invocationCallOrder[0],
    );
  });

  it("answers gone for an empty id without locking anything", async () => {
    expect(await run(client, { ...input, choreId: "" })).toEqual({ kind: "gone" });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("answers gone for an unknown or other household's id (no row locked)", async () => {
    tx.$queryRaw.mockResolvedValue([]);

    expect(await run(client, input)).toEqual({ kind: "gone" });
    expect(tx.chore.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("answers gone if the re-read finds the chore in another household", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ householdId: "household_9" }));

    expect(await run(client, input)).toEqual({ kind: "gone" });
    expectNothingWritten();
  });

  it.each(["completed", "skipped"])("answers not-pending for a %s chore", async (status) => {
    tx.chore.findUnique.mockResolvedValue(chore({ status, assignees: [current("user_1")] }));

    expect(await run(client, input)).toEqual({ kind: "not-pending" });
    expectNothingWritten();
  });

  it("checks not-pending before fixed", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ status: "completed", assignmentMode: "fixed" }));

    expect(await run(client, input)).toEqual({ kind: "not-pending" });
  });

  it.each([
    ["with no assignees", []],
    ["the caller is assigned to", [current("user_1")]],
  ])("answers not-claim for a fixed chore %s", async (_label, assignees) => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "fixed", assignees }));

    expect(await run(client, input)).toEqual({ kind: "not-claim" });
    expectNothingWritten();
  });
});

describe("claimChoreInTransaction", () => {
  it("inserts one row for the caller and writes nothing else", async () => {
    const outcome = await claimChoreInTransaction(client, input);

    expect(outcome).toMatchObject({ kind: "claimed", chore: { id: "chore_1", title: "Water the plants" } });
    expect(tx.choreAssignee.create).toHaveBeenCalledTimes(1);
    expect(tx.choreAssignee.create).toHaveBeenCalledWith({ data: { choreId: "chore_1", userId: "user_1" } });
    expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
    expect(tx.choreAssignee.delete).not.toHaveBeenCalled();
    expect(tx.chore.update).not.toHaveBeenCalled();
    expect(tx.chore.create).not.toHaveBeenCalled();
    expect(tx.completionRecord.create).not.toHaveBeenCalled();
    expect(tx.skipRecord.create).not.toHaveBeenCalled();
    expect(tx.chore.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.choreAssignee.create.mock.invocationCallOrder[0],
    );
  });

  it("replaces the rows of former members: deletes them, then inserts the caller's", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignees: [former("user_8"), former("user_9")] }));

    expect((await claimChoreInTransaction(client, input)).kind).toBe("claimed");
    expect(tx.choreAssignee.deleteMany).toHaveBeenCalledWith({
      where: { choreId: "chore_1", userId: { in: ["user_8", "user_9"] } },
    });
    expect(tx.choreAssignee.create).toHaveBeenCalledWith({ data: { choreId: "chore_1", userId: "user_1" } });
    expect(tx.choreAssignee.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.choreAssignee.create.mock.invocationCallOrder[0],
    );
    expect(tx.chore.update).not.toHaveBeenCalled();
  });

  it.each([
    ["holds the only row", [current("user_1")]],
    ["holds a row next to someone else's", [current("user_2"), current("user_1")]],
  ])("answers claimed-by-you when the caller %s", async (_label, assignees) => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignees }));

    expect(await claimChoreInTransaction(client, input)).toEqual({ kind: "claimed-by-you" });
    expectNothingWritten();
  });

  it.each([
    ["another current member holds it", [current("user_2")]],
    ["a current member holds it next to a former member", [former("user_9"), current("user_2")]],
  ])("answers claimed-by-other when %s", async (_label, assignees) => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignees }));

    expect(await claimChoreInTransaction(client, input)).toEqual({ kind: "claimed-by-other" });
    expectNothingWritten();
  });

  it("checks fixed before claimed-by-you, and claimed-by-you before claimed-by-other", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignmentMode: "fixed", assignees: [current("user_1")] }));
    expect((await claimChoreInTransaction(client, input)).kind).toBe("not-claim");

    tx.chore.findUnique.mockResolvedValue(chore({ assignees: [current("user_2"), current("user_1")] }));
    expect((await claimChoreInTransaction(client, input)).kind).toBe("claimed-by-you");
  });

  it("rejects when the insert rejects", async () => {
    tx.choreAssignee.create.mockRejectedValue(new Error("insert failed"));

    await expect(claimChoreInTransaction(client, input)).rejects.toThrow("insert failed");
  });
});

describe("releaseChoreInTransaction", () => {
  it("deletes only the caller's row and writes nothing else", async () => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignees: [current("user_1")] }));

    const outcome = await releaseChoreInTransaction(client, input);

    expect(outcome).toMatchObject({ kind: "released", chore: { id: "chore_1", title: "Water the plants" } });
    expect(tx.choreAssignee.delete).toHaveBeenCalledTimes(1);
    expect(tx.choreAssignee.delete).toHaveBeenCalledWith({
      where: { choreId_userId: { choreId: "chore_1", userId: "user_1" } },
    });
    expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
    expect(tx.choreAssignee.create).not.toHaveBeenCalled();
    expect(tx.chore.update).not.toHaveBeenCalled();
  });

  it("leaves the other holders' rows when several current members hold it", async () => {
    tx.chore.findUnique.mockResolvedValue(
      chore({ assignees: [current("user_2"), current("user_1"), former("user_9")] }),
    );

    expect((await releaseChoreInTransaction(client, input)).kind).toBe("released");
    expect(tx.choreAssignee.delete).toHaveBeenCalledTimes(1);
    expect(tx.choreAssignee.delete.mock.calls[0][0].where.choreId_userId.userId).toBe("user_1");
    expect(tx.choreAssignee.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ["unclaimed", []],
    ["claimed by someone else", [current("user_2")]],
    ["claimed only by a former member", [former("user_9")]],
  ])("answers not-claimant when the chore is %s", async (_label, assignees) => {
    tx.chore.findUnique.mockResolvedValue(chore({ assignees }));

    expect(await releaseChoreInTransaction(client, input)).toEqual({ kind: "not-claimant" });
    expectNothingWritten();
  });
});
