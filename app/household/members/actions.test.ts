import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_ONLY_ERROR,
  LAST_ADMIN_ERROR,
  MEMBER_GONE_ERROR,
  REMOVE_SELF_ERROR,
} from "@/app/household/members/messages";

// The actions resolve the caller through the real `requireAdmin()` guard, so
// the session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  membership: { findUnique: vi.fn(), count: vi.fn(), delete: vi.fn() },
  inviteToken: { updateMany: vi.fn(), create: vi.fn() },
};
const $transaction = vi.fn(async (callback: (client: typeof tx) => unknown) =>
  callback(tx),
);
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

const { createInvite, regenerateInvite, removeMember } = await import("./actions");

const NOW = new Date("2026-10-16T12:00:00Z");
const SEVEN_DAYS_LATER = new Date("2026-10-23T12:00:00Z");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: "Alice" };
const household = { id: "household_1", name: "Home" };

function membership(
  id: string,
  userId: string,
  role: "admin" | "member",
  householdId = "household_1",
) {
  return { id, userId, householdId, role, createdAt: new Date("2026-01-01") };
}

const callerAdmin = membership("membership_1", "user_1", "admin");

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function expectNoWrites() {
  expect(tx.inviteToken.updateMany).not.toHaveBeenCalled();
  expect(tx.inviteToken.create).not.toHaveBeenCalled();
  expect(tx.membership.delete).not.toHaveBeenCalled();
}

function expectHouseholdLockedFirst(firstReadOrWrite: { mock: { invocationCallOrder: number[] } }) {
  const [strings, ...values] = tx.$queryRaw.mock.calls[0];
  expect(strings.join("?")).toMatch(/SELECT id FROM "Household" WHERE id = \? FOR UPDATE/);
  expect(values).toEqual(["household_1"]);
  expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
    firstReadOrWrite.mock.invocationCallOrder[0],
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue({ ...callerAdmin, household });
  $transaction.mockClear();
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "household_1" }]);
  tx.membership.findUnique.mockReset().mockResolvedValue(callerAdmin);
  tx.membership.count.mockReset().mockResolvedValue(2);
  tx.membership.delete.mockReset().mockResolvedValue({});
  tx.inviteToken.updateMany.mockReset().mockResolvedValue({ count: 1 });
  tx.inviteToken.create.mockReset().mockResolvedValue({ id: "invite_2" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["createInvite", createInvite],
  ["regenerateInvite", regenerateInvite],
])("%s", (_name, action) => {
  it("creates a token for the caller's household that expires in 7 days", async () => {
    await expect(action()).resolves.toEqual({});

    expect(tx.inviteToken.create).toHaveBeenCalledTimes(1);
    const { data } = tx.inviteToken.create.mock.calls[0][0];
    expect(data).toEqual({
      householdId: "household_1",
      createdById: "user_1",
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: SEVEN_DAYS_LATER,
    });
    expect(data).not.toHaveProperty("consumedAt");
    expect(revalidatePath).toHaveBeenCalledWith("/household/members");
  });

  it("locks the household row, re-reads the caller, then expires active tokens (not consumedAt)", async () => {
    await action();

    expectHouseholdLockedFirst(tx.membership.findUnique);
    expect(tx.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_householdId: { userId: "user_1", householdId: "household_1" } },
    });
    expect(tx.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { householdId: "household_1", consumedAt: null, expiresAt: { gt: NOW } },
      data: { expiresAt: NOW },
    });
    expect(tx.inviteToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.inviteToken.create.mock.invocationCallOrder[0],
    );
  });

  it("creates a different token each time", async () => {
    await action();
    await action();

    const [first, second] = tx.inviteToken.create.mock.calls.map((call) => call[0].data.token);
    expect(first).not.toBe(second);
  });

  it("refuses a member with the admin-only message and writes nothing", async () => {
    findFirst.mockResolvedValue({ ...membership("membership_1", "user_1", "member"), household });

    await expect(action()).resolves.toEqual({ error: ADMIN_ONLY_ERROR });
    expect($transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("refuses when the caller was demoted or removed before the lock was taken", async () => {
    tx.membership.findUnique.mockResolvedValue(null);
    await expect(action()).resolves.toEqual({ error: ADMIN_ONLY_ERROR });

    tx.membership.findUnique.mockResolvedValue(membership("membership_1", "user_1", "member"));
    await expect(action()).resolves.toEqual({ error: ADMIN_ONLY_ERROR });

    expectNoWrites();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(action()).rejects.toThrow("NEXT_REDIRECT /signin");
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects a caller with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(action()).rejects.toThrow("NEXT_REDIRECT /household/new");
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("removeMember", () => {
  const target = membership("membership_2", "user_2", "member");

  function withTarget(row: ReturnType<typeof membership> | null) {
    tx.membership.findUnique.mockImplementation(async ({ where }) =>
      "userId_householdId" in where ? callerAdmin : row,
    );
  }

  beforeEach(() => {
    withTarget(target);
  });

  it("deletes only the target membership and revalidates the page", async () => {
    await expect(removeMember({}, form({ membershipId: "membership_2" }))).resolves.toEqual({});

    expect(tx.membership.delete).toHaveBeenCalledTimes(1);
    expect(tx.membership.delete).toHaveBeenCalledWith({ where: { id: "membership_2" } });
    expect(tx.inviteToken.updateMany).not.toHaveBeenCalled();
    expect(tx.inviteToken.create).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/household/members");
  });

  it("locks the household row before re-reading the caller and the target", async () => {
    await removeMember({}, form({ membershipId: "membership_2" }));

    expectHouseholdLockedFirst(tx.membership.findUnique);
    expect(tx.membership.findUnique).toHaveBeenCalledWith({ where: { id: "membership_2" } });
  });

  it("removes another admin when one admin stays", async () => {
    withTarget(membership("membership_2", "user_2", "admin"));
    tx.membership.count.mockResolvedValue(2);

    await expect(removeMember({}, form({ membershipId: "membership_2" }))).resolves.toEqual({});
    expect(tx.membership.count).toHaveBeenCalledWith({
      where: { householdId: "household_1", role: "admin" },
    });
    expect(tx.membership.delete).toHaveBeenCalledWith({ where: { id: "membership_2" } });
  });

  it.each<[string, () => void, Record<string, string>, string]>([
    ["the caller themselves", () => withTarget(callerAdmin), { membershipId: "membership_1" }, REMOVE_SELF_ERROR],
    [
      "the only admin",
      () => {
        withTarget(membership("membership_2", "user_2", "admin"));
        tx.membership.count.mockResolvedValue(1);
      },
      { membershipId: "membership_2" },
      LAST_ADMIN_ERROR,
    ],
    [
      "a membership of another household",
      () => withTarget(membership("membership_9", "user_9", "member", "household_9")),
      { membershipId: "membership_9" },
      MEMBER_GONE_ERROR,
    ],
    ["an unknown id", () => withTarget(null), { membershipId: "membership_404" }, MEMBER_GONE_ERROR],
    ["a missing id", () => withTarget(target), {}, MEMBER_GONE_ERROR],
    [
      "a caller who is no longer an admin",
      () =>
        tx.membership.findUnique.mockImplementation(async ({ where }) =>
          "userId_householdId" in where ? membership("membership_1", "user_1", "member") : target,
        ),
      { membershipId: "membership_2" },
      ADMIN_ONLY_ERROR,
    ],
    [
      "a caller who was removed a moment earlier",
      () =>
        tx.membership.findUnique.mockImplementation(async ({ where }) =>
          "userId_householdId" in where ? null : target,
        ),
      { membershipId: "membership_2" },
      ADMIN_ONLY_ERROR,
    ],
  ])("refuses to remove %s and deletes nothing", async (_label, arrange, fields, error) => {
    arrange();

    await expect(removeMember({}, form(fields))).resolves.toEqual({ error });
    expectNoWrites();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a member with the admin-only message and writes nothing", async () => {
    findFirst.mockResolvedValue({ ...membership("membership_1", "user_1", "member"), household });

    await expect(removeMember({}, form({ membershipId: "membership_2" }))).resolves.toEqual({
      error: ADMIN_ONLY_ERROR,
    });
    expect($transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(removeMember({}, form({ membershipId: "membership_2" }))).rejects.toThrow(
      "NEXT_REDIRECT /signin",
    );
    expectNoWrites();
  });
});
