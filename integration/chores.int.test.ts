import { describe, expect, it } from "vitest";

import { deleteChore } from "@/app/chores/[id]/edit/actions";
import { claimChore, completeChore, skipChore, type ChoreActionState } from "@/app/chores/actions";
import {
  CHORE_CLAIMED_BY_OTHER_ERROR,
  CHORE_NOT_PENDING_ERROR,
  choreCompletedMessage,
} from "@/app/chores/messages";
import { db } from "@/lib/db";

import { addMember, createChore, createHousehold, createUser, form, redirectOf } from "./helpers";
import { asUser } from "./session";

const idle: ChoreActionState = { status: "idle" };

async function householdWithTwoMembers() {
  const admin = await createUser("Admin");
  const member = await createUser("Member");
  const household = await createHousehold(admin.id);
  await addMember(household.id, member.id);
  return { admin, member, household };
}

/** The chores of a household other than `choreId`, with their assignees. */
function otherChores(householdId: string, choreId: string) {
  return db.chore.findMany({
    where: { householdId, id: { not: choreId } },
    include: { assignees: { select: { userId: true } } },
  });
}

describe("complete", () => {
  it("marks a one-off chore completed and writes one CompletionRecord", async () => {
    const { member, household, admin } = await householdWithTwoMembers();
    const chore = await createChore(household.id, admin.id, { assignees: [member.id] });

    const before = Date.now();
    const result = await asUser(member.id, () =>
      completeChore(idle, form({ choreId: chore.id })),
    );

    expect(result).toEqual({ status: "success", message: choreCompletedMessage(chore.title) });
    expect((await db.chore.findUniqueOrThrow({ where: { id: chore.id } })).status).toBe(
      "completed",
    );
    const records = await db.completionRecord.findMany({ where: { choreId: chore.id } });
    expect(records).toHaveLength(1);
    expect(records[0].userId).toBe(member.id);
    expect(records[0].completedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(await otherChores(household.id, chore.id)).toEqual([]);
  });

  it("rolls a recurring fixed chore over to the next week with the same assignees", async () => {
    const { member, household, admin } = await householdWithTwoMembers();
    const category = await db.category.create({
      data: { householdId: household.id, name: "Kitchen" },
    });
    const dueAt = new Date("2026-03-02T18:30:00.000Z");
    const chore = await createChore(household.id, admin.id, {
      assignees: [admin.id, member.id],
      recurrence: "weekly",
      dueAt,
      categoryId: category.id,
      priority: "high",
    });

    await asUser(member.id, () => completeChore(idle, form({ choreId: chore.id })));

    const [next] = await otherChores(household.id, chore.id);
    expect(next).toMatchObject({
      status: "pending",
      title: chore.title,
      recurrence: "weekly",
      assignmentMode: "fixed",
      categoryId: category.id,
      priority: "high",
      createdById: admin.id,
    });
    expect(next.dueAt).toEqual(new Date("2026-03-09T18:30:00.000Z"));
    expect(next.assignees.map((a) => a.userId).sort()).toEqual([admin.id, member.id].sort());
  });

  it("rolls a monthly claim chore over unclaimed, clamping Jan 31 to Feb 28", async () => {
    const { member, household, admin } = await householdWithTwoMembers();
    const chore = await createChore(household.id, admin.id, {
      assignees: [member.id],
      assignmentMode: "claim",
      recurrence: "monthly",
      dueAt: new Date("2027-01-31T09:00:00.000Z"),
    });

    await asUser(member.id, () => completeChore(idle, form({ choreId: chore.id })));

    const [next] = await otherChores(household.id, chore.id);
    expect(next.status).toBe("pending");
    expect(next.assignmentMode).toBe("claim");
    expect(next.dueAt).toEqual(new Date("2027-02-28T09:00:00.000Z"));
    expect(next.assignees).toEqual([]);
  });

  it("writes exactly one CompletionRecord and one roll-over when two assignees complete at once", async () => {
    const { member, household, admin } = await householdWithTwoMembers();
    const chore = await createChore(household.id, admin.id, {
      assignees: [admin.id, member.id],
      recurrence: "daily",
      dueAt: new Date("2026-05-01T08:00:00.000Z"),
    });

    const results = await Promise.all(
      [admin.id, member.id, admin.id, member.id].map((userId) =>
        asUser(userId, () => completeChore(idle, form({ choreId: chore.id }))),
      ),
    );

    expect(results.filter((r) => r.status === "success")).toHaveLength(1);
    expect(results.filter((r) => r.status === "error")).toEqual(
      Array(3).fill({ status: "error", message: CHORE_NOT_PENDING_ERROR }),
    );
    expect(await db.completionRecord.count({ where: { choreId: chore.id } })).toBe(1);
    expect(await otherChores(household.id, chore.id)).toHaveLength(1);
  });
});

describe("claim", () => {
  it("gives a claim chore to exactly one of two members claiming at once", async () => {
    const { member, household, admin } = await householdWithTwoMembers();
    const chore = await createChore(household.id, admin.id, { assignmentMode: "claim" });

    const results = await Promise.all(
      [admin.id, member.id].map((userId) =>
        asUser(userId, () => claimChore(idle, form({ choreId: chore.id }))),
      ),
    );

    expect(results.filter((r) => r.status === "success")).toHaveLength(1);
    expect(results.filter((r) => r.status === "error")).toEqual([
      { status: "error", message: CHORE_CLAIMED_BY_OTHER_ERROR },
    ]);
    expect(await db.choreAssignee.count({ where: { choreId: chore.id } })).toBe(1);
  });
});

describe("skip", () => {
  it("writes a SkipRecord and never rolls a recurring chore over", async () => {
    const { member, household, admin } = await householdWithTwoMembers();
    const chore = await createChore(household.id, admin.id, {
      assignees: [admin.id],
      recurrence: "weekly",
      dueAt: new Date("2026-06-01T10:00:00.000Z"),
    });

    const result = await asUser(member.id, () =>
      skipChore(idle, form({ choreId: chore.id, reason: "  Away this week  " })),
    );

    expect(result.status).toBe("success");
    expect((await db.chore.findUniqueOrThrow({ where: { id: chore.id } })).status).toBe(
      "skipped",
    );
    const record = await db.skipRecord.findUniqueOrThrow({ where: { choreId: chore.id } });
    expect(record).toMatchObject({ userId: member.id, reason: "Away this week" });
    expect(await db.completionRecord.count()).toBe(0);
    expect(await otherChores(household.id, chore.id)).toEqual([]);
  });
});

describe("delete", () => {
  it("cascades a deleted chore's assignee, completion and skip rows, keeping its next occurrence", async () => {
    const { member, household, admin } = await householdWithTwoMembers();
    const completed = await createChore(household.id, admin.id, {
      assignees: [member.id],
      recurrence: "weekly",
      dueAt: new Date("2026-04-06T07:00:00.000Z"),
    });
    const skipped = await createChore(household.id, admin.id, { assignees: [member.id] });
    await asUser(member.id, () => completeChore(idle, form({ choreId: completed.id })));
    await asUser(member.id, () =>
      skipChore(idle, form({ choreId: skipped.id, reason: "Not needed" })),
    );
    const [next] = await otherChores(household.id, completed.id).then((chores) =>
      chores.filter((c) => c.id !== skipped.id),
    );

    for (const chore of [completed, skipped]) {
      expect(
        await redirectOf(asUser(admin.id, () => deleteChore({}, form({ choreId: chore.id })))),
      ).toBe("/chores?notice=deleted");
    }

    const deleted = [completed.id, skipped.id];
    expect(await db.chore.count({ where: { id: { in: deleted } } })).toBe(0);
    expect(await db.choreAssignee.count({ where: { choreId: { in: deleted } } })).toBe(0);
    expect(await db.completionRecord.count()).toBe(0);
    expect(await db.skipRecord.count()).toBe(0);
    // The next occurrence is its own chore and keeps its assignee.
    expect(await db.choreAssignee.count({ where: { choreId: next.id } })).toBe(1);
  });
});
