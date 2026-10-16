import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique }, membership: { findFirst } },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

// The form is a client component with a Server Action; it is not under test here.
vi.mock("@/app/household/new/household-form", () => ({ HouseholdForm: () => null }));

const { default: NewHouseholdPage, metadata } = await import("./page");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: null };
const household = { id: "household_1", name: "Home" };
const membershipRow = {
  id: "membership_1",
  userId: "user_1",
  householdId: "household_1",
  role: "admin",
  household,
};

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue(null);
  redirect.mockClear();
});

describe("/household/new page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("Create household · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin with a callbackUrl back here", async () => {
    auth.mockResolvedValue(null);

    await expect(NewHouseholdPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fhousehold%2Fnew");
  });

  it("treats a session whose user was deleted as signed out", async () => {
    findUnique.mockResolvedValue(null);

    await expect(NewHouseholdPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fhousehold%2Fnew");
  });

  it("redirects a user who already has a household to /", async () => {
    findFirst.mockResolvedValue(membershipRow);

    await expect(NewHouseholdPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("renders the form for a user with no household", async () => {
    await expect(NewHouseholdPage()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
