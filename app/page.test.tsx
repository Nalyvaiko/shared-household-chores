import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the household through the real `requireHousehold()` guard,
// so the session and the database are mocked underneath it.
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

const { default: Home } = await import("./page");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: null };
const membershipRow = {
  id: "membership_1",
  userId: "user_1",
  householdId: "household_1",
  role: "admin",
  household: { id: "household_1", name: "Home" },
};

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue(membershipRow);
  redirect.mockClear();
});

describe("/ page", () => {
  it("redirects a signed-out visitor to plain /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
  });

  it("redirects a session whose user was deleted to /signin", async () => {
    findUnique.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
  });

  it("redirects a user with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
  });

  it("renders the placeholder for a user with a household", async () => {
    await expect(Home()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("links the New chore button to /chores/new", async () => {
    const html = renderToStaticMarkup(await Home());

    expect(html).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });
});
