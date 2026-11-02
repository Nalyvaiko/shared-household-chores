import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_ONLY_ERROR,
  HOUSEHOLD_RENAMED_MESSAGE,
} from "@/app/household/settings/messages";
import {
  HOUSEHOLD_NAME_CONTROL_ERROR,
  HOUSEHOLD_NAME_EMPTY_ERROR,
  HOUSEHOLD_NAME_TOO_LONG_ERROR,
} from "@/lib/household/validation";

// The action resolves the caller through the real `requireAdmin()` guard, so
// the session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  membership: { findUnique: vi.fn() },
  household: { update: vi.fn() },
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

const { renameHousehold } = await import("./actions");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: "Alice" };
const household = { id: "household_1", name: "Home" };

function membership(role: "admin" | "member") {
  return {
    id: "membership_1",
    userId: "user_1",
    householdId: "household_1",
    role,
    createdAt: new Date("2026-01-01"),
  };
}

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue({ ...membership("admin"), household });
  $transaction.mockClear();
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "household_1" }]);
  tx.membership.findUnique.mockReset().mockResolvedValue(membership("admin"));
  tx.household.update.mockReset().mockResolvedValue({ ...household, name: "New" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

describe("renameHousehold", () => {
  it("renames the caller's household with the trimmed name and refreshes the layout", async () => {
    await expect(
      renameHousehold({ name: "Home" }, form({ name: "  Smith  Family  " })),
    ).resolves.toEqual({ name: "Smith  Family", success: HOUSEHOLD_RENAMED_MESSAGE });

    expect(tx.household.update).toHaveBeenCalledTimes(1);
    expect(tx.household.update).toHaveBeenCalledWith({
      where: { id: "household_1" },
      data: { name: "Smith  Family" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("locks the household row, then re-reads the caller, then updates", async () => {
    await renameHousehold({ name: "Home" }, form({ name: "Flat 4" }));

    const [strings, ...values] = tx.$queryRaw.mock.calls[0];
    expect(strings.join("?")).toMatch(/SELECT id FROM "Household" WHERE id = \? FOR UPDATE/);
    expect(values).toEqual(["household_1"]);
    expect(tx.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_householdId: { userId: "user_1", householdId: "household_1" } },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.membership.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.membership.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.household.update.mock.invocationCallOrder[0],
    );
  });

  it("saves an unchanged name as a success", async () => {
    await expect(renameHousehold({ name: "Home" }, form({ name: "Home" }))).resolves.toEqual({
      name: "Home",
      success: HOUSEHOLD_RENAMED_MESSAGE,
    });
    expect(tx.household.update).toHaveBeenCalledWith({
      where: { id: "household_1" },
      data: { name: "Home" },
    });
  });

  it("ignores a posted householdId", async () => {
    await renameHousehold({ name: "Home" }, form({ name: "Flat 4", householdId: "household_9" }));

    expect(tx.household.update).toHaveBeenCalledWith({
      where: { id: "household_1" },
      data: { name: "Flat 4" },
    });
  });

  it("accepts 60 emoji", async () => {
    const name = "🏠".repeat(60);

    await expect(renameHousehold({ name: "Home" }, form({ name }))).resolves.toEqual({
      name,
      success: HOUSEHOLD_RENAMED_MESSAGE,
    });
  });

  it.each([
    ["", HOUSEHOLD_NAME_EMPTY_ERROR],
    ["   ", HOUSEHOLD_NAME_EMPTY_ERROR],
    ["Smith\nFamily", HOUSEHOLD_NAME_CONTROL_ERROR],
    ["Smith\tFamily", HOUSEHOLD_NAME_CONTROL_ERROR],
    ["Smith\u0085", HOUSEHOLD_NAME_CONTROL_ERROR],
    ["a".repeat(61), HOUSEHOLD_NAME_TOO_LONG_ERROR],
  ])("rejects the invalid name %j, keeping what was typed and writing nothing", async (name, error) => {
    await expect(renameHousehold({ name: "Home" }, form({ name }))).resolves.toEqual({
      name,
      error,
    });
    expect($transaction).not.toHaveBeenCalled();
    expect(tx.household.update).not.toHaveBeenCalled();
  });

  it("rejects a missing name field", async () => {
    await expect(renameHousehold({ name: "Home" }, form())).resolves.toEqual({
      name: "",
      error: HOUSEHOLD_NAME_EMPTY_ERROR,
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("refuses a member before validating, keeping what was typed and writing nothing", async () => {
    findFirst.mockResolvedValue({ ...membership("member"), household });

    await expect(renameHousehold({ name: "Home" }, form({ name: "Flat 4" }))).resolves.toEqual({
      name: "Flat 4",
      error: ADMIN_ONLY_ERROR,
    });
    expect($transaction).not.toHaveBeenCalled();
    expect(tx.household.update).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses, writing nothing, when the caller lost admin before the lock was taken", async () => {
    tx.membership.findUnique.mockResolvedValue(membership("member"));

    await expect(renameHousehold({ name: "Home" }, form({ name: "Flat 4" }))).resolves.toEqual({
      name: "Flat 4",
      error: ADMIN_ONLY_ERROR,
    });
    expect(tx.household.update).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /household/new, writing nothing, when the caller was removed", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(renameHousehold({ name: "Home" }, form({ name: "Flat 4" }))).rejects.toThrow(
      "NEXT_REDIRECT /household/new",
    );
    expect(tx.household.update).not.toHaveBeenCalled();
    // After the transaction, not inside it.
    expect(await $transaction.mock.results[0].value).toBe("gone");
    expect(redirect.mock.invocationCallOrder[0]).toBeGreaterThan(
      $transaction.mock.invocationCallOrder[0],
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(renameHousehold({ name: "Home" }, form({ name: "Flat 4" }))).rejects.toThrow(
      "NEXT_REDIRECT /signin",
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects a caller with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(renameHousehold({ name: "Home" }, form({ name: "Flat 4" }))).rejects.toThrow(
      "NEXT_REDIRECT /household/new",
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it("rethrows a database error", async () => {
    tx.household.update.mockRejectedValue(new Error("connection lost"));

    await expect(renameHousehold({ name: "Home" }, form({ name: "Flat 4" }))).rejects.toThrow(
      "connection lost",
    );
  });
});
