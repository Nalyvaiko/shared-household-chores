import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The action resolves the user through the real `requireUser()` guard, so the
// session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  membership: { findFirst: vi.fn(), create: vi.fn() },
  inviteToken: { findUnique: vi.fn(), updateMany: vi.fn() },
};
const $transaction = vi.fn(async (callback: (client: typeof tx) => unknown) =>
  callback(tx),
);
vi.mock("@/lib/db", () => ({ db: { user: { findUnique }, $transaction } }));

// Like the real one, `redirect` throws so the action stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { joinHousehold } = await import("./actions");

const NOW = new Date("2026-10-16T12:00:00Z");
const TOKEN = "A".repeat(20) + "_-" + "b".repeat(21);
const session = { user: { id: "user_1", email: "bob@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "bob@example.com", name: "Bob" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function submit(token: string = TOKEN) {
  return joinHousehold({}, form({ token }));
}

function rawQuery(index: number) {
  const [strings, ...values] = tx.$queryRaw.mock.calls[index];
  return { sql: strings.join("?"), values };
}

function expectNoWrites() {
  expect(tx.inviteToken.updateMany).not.toHaveBeenCalled();
  expect(tx.membership.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  $transaction.mockClear();
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "locked" }]);
  tx.membership.findFirst.mockReset().mockResolvedValue(null);
  tx.membership.create.mockReset().mockResolvedValue({});
  tx.inviteToken.findUnique.mockReset().mockResolvedValue({ householdId: "household_1" });
  tx.inviteToken.updateMany.mockReset().mockResolvedValue({ count: 1 });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("joinHousehold", () => {
  it("consumes the token, adds a member membership, refreshes the layout and goes home", async () => {
    await expect(submit()).rejects.toThrow("NEXT_REDIRECT /");

    expect(tx.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { token: TOKEN, consumedAt: null, expiresAt: { gt: NOW } },
      data: { consumedAt: NOW },
    });
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: "user_1", householdId: "household_1", role: "member" },
    });
    expect(tx.inviteToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.membership.create.mock.invocationCallOrder[0],
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(redirect).toHaveBeenCalledWith("/");
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      redirect.mock.invocationCallOrder[0],
    );
  });

  it("reads the token, then locks User, then Household, then re-checks membership", async () => {
    await expect(submit()).rejects.toThrow("NEXT_REDIRECT /");

    expect(tx.inviteToken.findUnique).toHaveBeenNthCalledWith(1, {
      where: { token: TOKEN },
      select: { householdId: true },
    });
    expect(rawQuery(0).sql).toMatch(/SELECT id FROM "User" WHERE id = \? FOR UPDATE/);
    expect(rawQuery(0).values).toEqual(["user_1"]);
    expect(rawQuery(1).sql).toMatch(/SELECT id FROM "Household" WHERE id = \? FOR UPDATE/);
    expect(rawQuery(1).values).toEqual(["household_1"]);
    expect(tx.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } }),
    );

    const order = [
      tx.inviteToken.findUnique.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[1],
      tx.membership.findFirst.mock.invocationCallOrder[0],
      tx.inviteToken.updateMany.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("takes the user from the session, never from the form", async () => {
    const data = form({ token: TOKEN, userId: "user_2", householdId: "household_2" });

    await expect(joinHousehold({}, data)).rejects.toThrow("NEXT_REDIRECT /");

    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: "user_1", householdId: "household_1", role: "member" },
    });
  });

  it("reports already used when nothing was updated and consumedAt is set", async () => {
    tx.inviteToken.updateMany.mockResolvedValue({ count: 0 });
    tx.inviteToken.findUnique
      .mockResolvedValueOnce({ householdId: "household_1" })
      .mockResolvedValueOnce({ consumedAt: new Date("2026-10-16T11:59:59Z") });

    await expect(submit()).resolves.toEqual({ problem: "used" });
    expect(tx.membership.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("reports expired when nothing was updated and consumedAt is not set", async () => {
    tx.inviteToken.updateMany.mockResolvedValue({ count: 0 });
    tx.inviteToken.findUnique
      .mockResolvedValueOnce({ householdId: "household_1" })
      .mockResolvedValueOnce({ consumedAt: null });

    await expect(submit()).resolves.toEqual({ problem: "expired" });
    expect(tx.membership.create).not.toHaveBeenCalled();
  });

  it("reports unknown when no invite has the token", async () => {
    tx.inviteToken.findUnique.mockResolvedValue(null);

    await expect(submit()).resolves.toEqual({ problem: "unknown" });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("sends a second submit from someone already in this household home, consuming nothing", async () => {
    tx.membership.findFirst.mockResolvedValue({ householdId: "household_1" });

    await expect(submit()).rejects.toThrow("NEXT_REDIRECT /");
    expect(redirect).toHaveBeenCalledWith("/");
    expectNoWrites();
  });

  it("refuses someone already in another household, consuming nothing", async () => {
    tx.membership.findFirst.mockResolvedValue({ householdId: "household_2" });

    await expect(submit()).resolves.toEqual({ problem: "other-household" });
    expectNoWrites();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(44)],
    ["other characters", "a".repeat(42) + "/"],
    ["empty", ""],
  ])("reports unknown for a %s token without touching the session or database", async (_label, token) => {
    await expect(submit(token)).resolves.toEqual({ problem: "unknown" });
    expect(auth).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("reports unknown when the form has no token", async () => {
    await expect(joinHousehold({}, new FormData())).resolves.toEqual({ problem: "unknown" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects a signed-out caller to /signin with a callbackUrl back to the link", async () => {
    auth.mockResolvedValue(null);

    await expect(submit()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(`/signin?callbackUrl=%2Finvite%2F${TOKEN}`);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects to /signin when the user row is gone by the time it is locked", async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(submit()).rejects.toThrow("NEXT_REDIRECT /signin");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expectNoWrites();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports unknown when the household is gone by the time it is locked", async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: "user_1" }]).mockResolvedValueOnce([]);

    await expect(submit()).resolves.toEqual({ problem: "unknown" });
    expectNoWrites();
  });
});
