import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CATEGORY_BUILTIN_ERROR,
  CATEGORY_DUPLICATE_ERROR,
  CATEGORY_GONE_ERROR,
} from "@/app/household/categories/messages";
import {
  CATEGORY_NAME_CONTROL_ERROR,
  CATEGORY_NAME_EMPTY_ERROR,
  CATEGORY_NAME_TOO_LONG_ERROR,
} from "@/lib/category/validation";

// The actions resolve the caller through the real `requireHousehold()` guard,
// so the session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  membership: { findUnique: vi.fn() },
  category: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
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

const { addCategory, deleteCategory } = await import("./actions");

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

function category(id: string, name: string, builtIn: boolean, householdId = "household_1") {
  return { id, name, builtIn, householdId };
}

const builtIns = ["Kitchen", "Bathroom", "Cleaning", "Laundry", "Outdoor", "Pets", "Admin"].map(
  (name, index) => category(`builtin_${index}`, name, true),
);
const garden = category("custom_1", "Garden", false);

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`householdId`,`name`)",
    { code: "P2002", clientVersion: Prisma.prismaVersion.client },
  );
}

function expectNoWrites() {
  expect(tx.category.create).not.toHaveBeenCalled();
  expect(tx.category.delete).not.toHaveBeenCalled();
}

function expectHouseholdLockedFirst(firstRead: { mock: { invocationCallOrder: number[] } }) {
  const [strings, ...values] = tx.$queryRaw.mock.calls[0];
  expect(strings.join("?")).toMatch(/SELECT id FROM "Household" WHERE id = \? FOR UPDATE/);
  expect(values).toEqual(["household_1"]);
  expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
    firstRead.mock.invocationCallOrder[0],
  );
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue({ ...membership("admin"), household });
  $transaction.mockClear();
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: "household_1" }]);
  tx.membership.findUnique.mockReset().mockResolvedValue(membership("admin"));
  tx.category.findMany.mockReset().mockResolvedValue([...builtIns, garden]);
  tx.category.findUnique.mockReset().mockResolvedValue(garden);
  tx.category.create.mockReset().mockResolvedValue({ id: "custom_2" });
  tx.category.delete.mockReset().mockResolvedValue(garden);
  redirect.mockClear();
  revalidatePath.mockClear();
});

describe("addCategory", () => {
  it("creates a custom category for the caller's household with the trimmed name", async () => {
    await expect(addCategory({ name: "" }, form({ name: "  Garden  tools  " }))).resolves.toEqual({
      name: "",
    });

    expect(tx.category.create).toHaveBeenCalledTimes(1);
    expect(tx.category.create).toHaveBeenCalledWith({
      data: { householdId: "household_1", name: "Garden  tools", builtIn: false },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/household/categories");
  });

  it("locks the household row, re-reads the caller, then loads the names", async () => {
    await addCategory({ name: "" }, form({ name: "Bikes" }));

    expectHouseholdLockedFirst(tx.membership.findUnique);
    expect(tx.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_householdId: { userId: "user_1", householdId: "household_1" } },
    });
    expect(tx.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household_1" } }),
    );
    expect(tx.membership.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.category.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.create.mock.invocationCallOrder[0],
    );
  });

  it("keeps the case as typed", async () => {
    await addCategory({ name: "" }, form({ name: "bIkEs" }));

    expect(tx.category.create.mock.calls[0][0].data.name).toBe("bIkEs");
  });

  it("ignores a posted householdId and builtIn", async () => {
    await addCategory(
      { name: "" },
      form({ name: "Bikes", householdId: "household_9", builtIn: "true" }),
    );

    expect(tx.category.create).toHaveBeenCalledWith({
      data: { householdId: "household_1", name: "Bikes", builtIn: false },
    });
  });

  it("lets a member add a category", async () => {
    findFirst.mockResolvedValue({ ...membership("member"), household });
    tx.membership.findUnique.mockResolvedValue(membership("member"));

    await expect(addCategory({ name: "" }, form({ name: "Bikes" }))).resolves.toEqual({ name: "" });
    expect(tx.category.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["kitchen", "the built-in Kitchen"],
    ["ADMIN", "the built-in Admin"],
    ["GARDEN", "the custom Garden"],
    [" garden ", "the custom Garden, after trimming"],
  ])("rejects %j because of %s and writes nothing", async (name) => {
    await expect(addCategory({ name: "" }, form({ name }))).resolves.toEqual({
      name,
      error: CATEGORY_DUPLICATE_ERROR,
    });
    expectNoWrites();
    expect(revalidatePath).toHaveBeenCalledWith("/household/categories");
  });

  it("maps a P2002 from the insert to the duplicate message", async () => {
    tx.category.findMany.mockResolvedValue(builtIns);
    tx.category.create.mockRejectedValue(uniqueViolation());

    await expect(addCategory({ name: "" }, form({ name: "Garden" }))).resolves.toEqual({
      name: "Garden",
      error: CATEGORY_DUPLICATE_ERROR,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/household/categories");
  });

  it("rethrows any other database error", async () => {
    tx.category.create.mockRejectedValue(new Error("connection lost"));

    await expect(addCategory({ name: "" }, form({ name: "Bikes" }))).rejects.toThrow(
      "connection lost",
    );
  });

  it.each([
    ["   ", CATEGORY_NAME_EMPTY_ERROR],
    ["Garden\ntools", CATEGORY_NAME_CONTROL_ERROR],
    ["Garden\ttools", CATEGORY_NAME_CONTROL_ERROR],
    ["Garden\u0085", CATEGORY_NAME_CONTROL_ERROR],
    ["a".repeat(31), CATEGORY_NAME_TOO_LONG_ERROR],
  ])("rejects the invalid name %j, keeping what was typed", async (name, error) => {
    await expect(addCategory({ name: "" }, form({ name }))).resolves.toEqual({ name, error });
    expect($transaction).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/household/categories");
  });

  it("rejects a missing name field", async () => {
    await expect(addCategory({ name: "" }, form())).resolves.toEqual({
      name: "",
      error: CATEGORY_NAME_EMPTY_ERROR,
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("accepts 30 emoji", async () => {
    const name = "🧹".repeat(30);

    await expect(addCategory({ name: "" }, form({ name }))).resolves.toEqual({ name: "" });
    expect(tx.category.create.mock.calls[0][0].data.name).toBe(name);
  });

  it("redirects to /household/new, writing nothing, when the caller's membership is gone", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(addCategory({ name: "" }, form({ name: "Bikes" }))).rejects.toThrow(
      "NEXT_REDIRECT /household/new",
    );
    expectNoWrites();
    expect(tx.category.findMany).not.toHaveBeenCalled();
    // After the transaction, not inside it.
    expect(redirect.mock.invocationCallOrder[0]).toBeGreaterThan(
      $transaction.mock.invocationCallOrder[0],
    );
    expect(await $transaction.mock.results[0].value).toBe("gone");
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(addCategory({ name: "" }, form({ name: "Bikes" }))).rejects.toThrow(
      "NEXT_REDIRECT /signin",
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it("redirects a caller with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(addCategory({ name: "" }, form({ name: "Bikes" }))).rejects.toThrow(
      "NEXT_REDIRECT /household/new",
    );
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("deleteCategory", () => {
  it("deletes only that custom category and revalidates the page", async () => {
    await expect(deleteCategory({}, form({ categoryId: "custom_1" }))).resolves.toEqual({});

    expect(tx.category.delete).toHaveBeenCalledTimes(1);
    expect(tx.category.delete).toHaveBeenCalledWith({ where: { id: "custom_1" } });
    expect(revalidatePath).toHaveBeenCalledWith("/household/categories");
  });

  it("locks the household row before re-reading the caller and the category", async () => {
    await deleteCategory({}, form({ categoryId: "custom_1" }));

    expectHouseholdLockedFirst(tx.membership.findUnique);
    expect(tx.category.findUnique).toHaveBeenCalledWith({ where: { id: "custom_1" } });
    expect(tx.membership.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.findUnique.mock.invocationCallOrder[0],
    );
  });

  it("lets a member delete a custom category", async () => {
    findFirst.mockResolvedValue({ ...membership("member"), household });
    tx.membership.findUnique.mockResolvedValue(membership("member"));

    await expect(deleteCategory({}, form({ categoryId: "custom_1" }))).resolves.toEqual({});
    expect(tx.category.delete).toHaveBeenCalledWith({ where: { id: "custom_1" } });
  });

  it.each<[string, ReturnType<typeof category> | null, Record<string, string>, string]>([
    ["a built-in category", builtIns[0], { categoryId: "builtin_0" }, CATEGORY_BUILTIN_ERROR],
    ["an unknown id", null, { categoryId: "custom_404" }, CATEGORY_GONE_ERROR],
    [
      "another household's category",
      category("custom_9", "Garden", false, "household_9"),
      { categoryId: "custom_9" },
      CATEGORY_GONE_ERROR,
    ],
    [
      "another household's built-in",
      category("builtin_9", "Kitchen", true, "household_9"),
      { categoryId: "builtin_9" },
      CATEGORY_GONE_ERROR,
    ],
    ["a missing id", garden, {}, CATEGORY_GONE_ERROR],
  ])("refuses to delete %s and deletes nothing", async (_label, row, fields, error) => {
    tx.category.findUnique.mockResolvedValue(row);

    await expect(deleteCategory({}, form(fields))).resolves.toEqual({ error });
    expectNoWrites();
    // A refusal re-renders too, so a stale row disappears.
    expect(revalidatePath).toHaveBeenCalledWith("/household/categories");
  });

  it("does not look up a missing id", async () => {
    await deleteCategory({}, form());

    expect(tx.category.findUnique).not.toHaveBeenCalled();
  });

  it("redirects to /household/new, writing nothing, when the caller's membership is gone", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(deleteCategory({}, form({ categoryId: "custom_1" }))).rejects.toThrow(
      "NEXT_REDIRECT /household/new",
    );
    expectNoWrites();
    expect(redirect.mock.invocationCallOrder[0]).toBeGreaterThan(
      $transaction.mock.invocationCallOrder[0],
    );
    expect(await $transaction.mock.results[0].value).toBe("gone");
  });

  it("redirects a signed-out caller to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(deleteCategory({}, form({ categoryId: "custom_1" }))).rejects.toThrow(
      "NEXT_REDIRECT /signin",
    );
    expect($transaction).not.toHaveBeenCalled();
  });
});
