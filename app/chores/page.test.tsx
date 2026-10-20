import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const choreFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst },
    chore: { findMany: choreFindMany },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { default: ChoresPage, metadata } = await import("./page");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Smith Family" };
const membership = { id: "membership_1", userId: "user_1", householdId: "household_1", role: "member", household };

async function render() {
  return renderToStaticMarkup(await ChoresPage());
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(membership);
  choreFindMany.mockReset().mockResolvedValue([
    { id: "chore_2", title: "Water the plants" },
    { id: "chore_1", title: "Take out the bins" },
  ]);
  redirect.mockClear();
});

describe("/chores placeholder page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("Chores · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(ChoresPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fchores");
    expect(choreFindMany).not.toHaveBeenCalled();
  });

  it("redirects a user with no household to /household/new", async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(ChoresPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect(choreFindMany).not.toHaveBeenCalled();
  });

  it("loads only the caller's household's chores, newest first", async () => {
    await render();

    expect(choreFindMany).toHaveBeenCalledWith({
      where: { householdId: "household_1" },
      select: { id: true, title: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("shows the heading, a New chore link and the titles in query order", async () => {
    const html = await render();

    expect(html).toContain("Household chores");
    expect(html).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    const titles = [...html.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((match) => match[1]);
    expect(titles).toEqual(["Water the plants", "Take out the bins"]);
    expect(html).not.toContain("No chores yet.");
  });

  it("shows the empty state when there are no chores", async () => {
    choreFindMany.mockResolvedValue([]);

    const html = await render();

    expect(html).toContain("No chores yet.");
    expect(html).not.toContain("<li");
  });
});
