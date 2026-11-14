import { describe, expect, it } from "vitest";

import { changeMemberRole, regenerateInvite, removeMember } from "@/app/household/members/actions";
import { ADMIN_ONLY_ERROR } from "@/app/household/members/messages";
import { createHousehold as createHouseholdAction } from "@/app/household/new/actions";
import { joinHousehold } from "@/app/invite/[token]/actions";
import { BUILTIN_CATEGORY_NAMES } from "@/lib/builtin-categories";
import { db } from "@/lib/db";
import { activeInviteWhere, generateInviteToken, INVITE_TTL_MS } from "@/lib/household/invite";

import { addMember, createChore, createHousehold, createUser, form, redirectOf } from "./helpers";
import { asUser } from "./session";

describe("create household", () => {
  it("creates one household and membership when one user submits three times at once", async () => {
    const user = await createUser("Founder");

    const targets = await Promise.all(
      [1, 2, 3].map(() =>
        redirectOf(
          asUser(user.id, () => createHouseholdAction({ name: "" }, form({ name: "Flat 4" }))),
        ),
      ),
    );

    expect(targets).toEqual(["/", "/", "/"]);
    const memberships = await db.membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("admin");
    expect(await db.household.count()).toBe(1);
    expect(await db.category.count({ where: { builtIn: true } })).toBe(
      BUILTIN_CATEGORY_NAMES.length,
    );
  });
});

describe("invite links", () => {
  it("never deadlocks or leaves two active links when a join races regenerates", async () => {
    const admin = await createUser("Admin");
    const household = await createHousehold(admin.id);

    for (let round = 0; round < 5; round += 1) {
      const now = new Date();
      await db.inviteToken.updateMany({
        where: activeInviteWhere(household.id, now),
        data: { expiresAt: now },
      });
      const { token } = await db.inviteToken.create({
        data: {
          householdId: household.id,
          createdById: admin.id,
          token: generateInviteToken(),
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        },
      });
      const joiner = await createUser(`Joiner${round}`);

      const [join, ...regenerates] = await Promise.all([
        asUser(joiner.id, () =>
          joinHousehold({}, form({ token })).then(
            (state) => state,
            (error: unknown) => redirectOf(Promise.reject(error)),
          ),
        ),
        asUser(admin.id, () => regenerateInvite()),
        asUser(admin.id, () => regenerateInvite()),
      ]);

      expect(regenerates).toEqual([{}, {}]);
      const joined = await db.membership.count({ where: { userId: joiner.id } });
      // Either the join won the lock (redirected home, link used) or a
      // regenerate did (the old link reads as expired).
      expect(join).toEqual(joined === 1 ? "/" : { problem: "expired" });
      expect(
        await db.inviteToken.count({ where: activeInviteWhere(household.id, new Date()) }),
      ).toBe(1);
    }
  });
});

describe("remove member", () => {
  it("unassigns the member in this household only and keeps their records", async () => {
    const admin = await createUser("Admin");
    const leaver = await createUser("Leaver");
    const home = await createHousehold(admin.id, "Home");
    const leaverMembership = await addMember(home.id, leaver.id);
    // The same person in a second household, with an assignment there.
    const otherAdmin = await createUser("OtherAdmin");
    const other = await createHousehold(otherAdmin.id, "Other");
    await addMember(other.id, leaver.id);
    const elsewhere = await createChore(other.id, otherAdmin.id, { assignees: [leaver.id] });

    const pending = await createChore(home.id, admin.id, { assignees: [leaver.id, admin.id] });
    const created = await createChore(home.id, leaver.id, { assignees: [leaver.id] });
    const done = await createChore(home.id, admin.id, {
      assignees: [leaver.id],
      status: "completed",
      completionRecord: { create: { userId: leaver.id } },
    });
    const skipped = await createChore(home.id, admin.id, {
      status: "skipped",
      skipRecord: { create: { userId: leaver.id, reason: "Ill" } },
    });

    const result = await asUser(admin.id, () =>
      removeMember({}, form({ membershipId: leaverMembership.id })),
    );

    expect(result).toEqual({});
    expect(await db.membership.findMany({ where: { userId: leaver.id } })).toEqual([
      expect.objectContaining({ householdId: other.id }),
    ]);
    expect(
      await db.choreAssignee.findMany({
        where: { choreId: { in: [pending.id, created.id, done.id] } },
        select: { choreId: true, userId: true },
      }),
    ).toEqual([{ choreId: pending.id, userId: admin.id }]);
    expect(await db.choreAssignee.count({ where: { choreId: elsewhere.id } })).toBe(1);
    expect(await db.completionRecord.count({ where: { choreId: done.id } })).toBe(1);
    expect(await db.skipRecord.count({ where: { choreId: skipped.id } })).toBe(1);
    expect(await db.chore.count({ where: { id: created.id } })).toBe(1);
  });
});

describe("change role", () => {
  it("keeps one admin when two admins demote each other at once", async () => {
    for (let round = 0; round < 5; round += 1) {
      const first = await createUser("First");
      const second = await createUser("Second");
      const household = await createHousehold(first.id);
      const firstMembership = await db.membership.findFirstOrThrow({
        where: { userId: first.id },
      });
      const secondMembership = await addMember(household.id, second.id, "admin");

      const results = await Promise.all([
        asUser(first.id, () =>
          changeMemberRole({}, form({ membershipId: secondMembership.id, role: "member" })),
        ),
        asUser(second.id, () =>
          changeMemberRole({}, form({ membershipId: firstMembership.id, role: "member" })),
        ),
      ]);

      // The loser was demoted before its turn under the lock.
      expect(results).toContainEqual({});
      expect(results).toContainEqual({ error: ADMIN_ONLY_ERROR });
      expect(
        await db.membership.count({ where: { householdId: household.id, role: "admin" } }),
      ).toBe(1);
    }
  });

  it("keeps one admin when one admin demotes the other while being removed by them", async () => {
    for (let round = 0; round < 5; round += 1) {
      const first = await createUser("First");
      const second = await createUser("Second");
      const household = await createHousehold(first.id);
      const firstMembership = await db.membership.findFirstOrThrow({
        where: { userId: first.id },
      });
      const secondMembership = await addMember(household.id, second.id, "admin");

      const [demote, remove] = await Promise.all([
        asUser(first.id, () =>
          changeMemberRole({}, form({ membershipId: secondMembership.id, role: "member" })).catch(
            (error: unknown) => redirectOf(Promise.reject(error)),
          ),
        ),
        asUser(second.id, () => removeMember({}, form({ membershipId: firstMembership.id }))),
      ]);

      // Demote first: the removal is refused. Remove first: the demoting
      // admin is gone and sent to create a household.
      expect([
        [{}, { error: ADMIN_ONLY_ERROR }],
        ["/household/new", {}],
      ]).toContainEqual([demote, remove]);
      expect(
        await db.membership.count({ where: { householdId: household.id, role: "admin" } }),
      ).toBe(1);
    }
  });
});
