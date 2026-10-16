import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_CATEGORY_NAMES } from "@/lib/builtin-categories";
import {
  HOUSEHOLD_NAME_CONTROL_ERROR,
  HOUSEHOLD_NAME_EMPTY_ERROR,
  HOUSEHOLD_NAME_TOO_LONG_ERROR,
} from "@/lib/household/validation";

// The action resolves the user through the real `requireUser()` guard, so the
// session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  membership: { findFirst: vi.fn(), create: vi.fn() },
  household: { create: vi.fn() },
  category: { createMany: vi.fn() },
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

const { createHousehold } = await import("./actions");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: null };

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function submit(fields: Record<string, string | Blob>) {
  return createHousehold({ name: "" }, form(fields));
}

function expectNoWrites() {
  expect(tx.household.create).not.toHaveBeenCalled();
  expect(tx.membership.create).not.toHaveBeenCalled();
  expect(tx.category.createMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  $transaction.mockClear();
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "user_1" }]);
  tx.membership.findFirst.mockReset().mockResolvedValue(null);
  tx.membership.create.mockReset().mockResolvedValue({ id: "membership_1" });
  tx.household.create.mockReset().mockResolvedValue({ id: "household_1" });
  tx.category.createMany.mockReset().mockResolvedValue({ count: 7 });
  redirect.mockClear();
});

describe("createHousehold", () => {
  it("creates the household, an admin membership and the built-in categories, then redirects to /", async () => {
    await expect(submit({ name: "  Smith Family  " })).rejects.toThrow("NEXT_REDIRECT /");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.household.create).toHaveBeenCalledWith({ data: { name: "Smith Family" } });
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: "user_1", householdId: "household_1", role: "admin" },
    });

    const { data: categories } = tx.category.createMany.mock.calls[0][0];
    expect(categories).toHaveLength(7);
    expect(categories).toEqual(
      BUILTIN_CATEGORY_NAMES.map((name) => ({
        householdId: "household_1",
        name,
        builtIn: true,
      })),
    );
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("locks the user's row before re-checking the membership", async () => {
    await expect(submit({ name: "Home" })).rejects.toThrow("NEXT_REDIRECT /");

    const [strings, ...values] = tx.$queryRaw.mock.calls[0];
    expect(strings.join("?")).toMatch(/SELECT id FROM "User" WHERE id = \? FOR UPDATE/);
    expect(values).toEqual(["user_1"]);
    expect(tx.membership.findFirst).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.membership.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.membership.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.household.create.mock.invocationCallOrder[0],
    );
  });

  it("creates nothing and redirects to / when the re-check finds a membership", async () => {
    tx.membership.findFirst.mockResolvedValue({ id: "membership_0", userId: "user_1" });

    await expect(submit({ name: "Home" })).rejects.toThrow("NEXT_REDIRECT /");

    expectNoWrites();
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("creates nothing and redirects to /signin when the user row is gone", async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(submit({ name: "Home" })).rejects.toThrow("NEXT_REDIRECT /signin");

    expect(tx.membership.findFirst).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("redirects a signed-out caller to /signin without touching the database", async () => {
    auth.mockResolvedValue(null);

    await expect(submit({ name: "Home" })).rejects.toThrow("NEXT_REDIRECT /signin");

    expect(redirect).toHaveBeenCalledWith("/signin");
    expect($transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("never takes the user or household from the form", async () => {
    await expect(
      submit({ name: "Home", userId: "user_2", householdId: "household_9" }),
    ).rejects.toThrow("NEXT_REDIRECT /");

    expect(tx.membership.create.mock.calls[0][0].data).toMatchObject({
      userId: "user_1",
      householdId: "household_1",
    });
  });

  it("lets a failed write propagate so the transaction rolls back", async () => {
    const failure = new Error("connection lost");
    tx.category.createMany.mockRejectedValue(failure);

    await expect(submit({ name: "Home" })).rejects.toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["exactly 60 characters", "a".repeat(60)],
    ["60 emoji", "🏠".repeat(60)],
    ["a name with an emoji", "🏠 Home"],
  ])("accepts %s", async (_label, name) => {
    await expect(submit({ name })).rejects.toThrow("NEXT_REDIRECT /");

    expect(tx.household.create).toHaveBeenCalledWith({ data: { name } });
  });

  it.each<[string, Record<string, string | Blob>, string]>([
    ["an empty name", { name: "" }, HOUSEHOLD_NAME_EMPTY_ERROR],
    ["a whitespace-only name", { name: "   " }, HOUSEHOLD_NAME_EMPTY_ERROR],
    ["a tab", { name: "\t" }, HOUSEHOLD_NAME_EMPTY_ERROR],
    ["a non-breaking space", { name: " " }, HOUSEHOLD_NAME_EMPTY_ERROR],
    ["61 characters", { name: "a".repeat(61) }, HOUSEHOLD_NAME_TOO_LONG_ERROR],
    ["61 emoji", { name: "🏠".repeat(61) }, HOUSEHOLD_NAME_TOO_LONG_ERROR],
    ["a newline inside the name", { name: "Smith\nFamily" }, HOUSEHOLD_NAME_CONTROL_ERROR],
    ["a tab inside the name", { name: "Smith\tFamily" }, HOUSEHOLD_NAME_CONTROL_ERROR],
    ["a NUL character", { name: "Smith\u0000" }, HOUSEHOLD_NAME_CONTROL_ERROR],
    ["DEL", { name: "Smith\u007f" }, HOUSEHOLD_NAME_CONTROL_ERROR],
    ["a C1 control", { name: "Smith\u0085Family" }, HOUSEHOLD_NAME_CONTROL_ERROR],
    ["a file instead of a string", { name: new File(["x"], "name.txt") }, HOUSEHOLD_NAME_EMPTY_ERROR],
  ])("rejects %s, keeps the input and writes nothing", async (_label, fields, error) => {
    const state = await submit(fields);

    expect(state.errors?.name).toEqual([error]);
    expect(state.name).toBe(typeof fields.name === "string" ? fields.name : "");
    expect($transaction).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("treats a missing name field as empty", async () => {
    const state = await createHousehold({ name: "" }, new FormData());

    expect(state).toEqual({ name: "", errors: { name: [HOUSEHOLD_NAME_EMPTY_ERROR] } });
    expect($transaction).not.toHaveBeenCalled();
  });
});
