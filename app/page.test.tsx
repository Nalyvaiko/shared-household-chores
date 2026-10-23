import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the household through the real `requireHousehold()` guard,
// so the session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
const choreFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique },
    membership: { findFirst },
    chore: { findMany: choreFindMany },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { default: Home } = await import("./page");

const NOW = new Date("2026-10-23T12:00:00.000Z");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: null };
const membershipRow = {
  id: "membership_1",
  userId: "user_1",
  householdId: "household_1",
  role: "admin",
  household: { id: "household_1", name: "Home" },
};

const me = {
  userId: "user_1",
  user: { name: null, email: "alice@example.com", memberships: [{ id: "membership_1" }] },
};

function chore(overrides: Record<string, unknown>) {
  return {
    id: "chore_x",
    householdId: "household_1",
    createdById: "user_1",
    categoryId: null,
    category: null,
    title: "A chore",
    dueAt: null,
    priority: "medium",
    effort: "medium",
    status: "pending",
    recurrence: "none",
    assignmentMode: "fixed",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    assignees: [me],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue(membershipRow);
  choreFindMany.mockReset().mockResolvedValue([
    chore({
      id: "chore_1",
      title: "Overdue bins",
      dueAt: new Date("2026-10-20T07:00:00.000Z"),
    }),
    chore({
      id: "chore_2",
      title: "Upcoming hoovering",
      dueAt: new Date("2026-10-25T18:15:00.000Z"),
      assignmentMode: "claim",
    }),
    chore({ id: "chore_3", title: "Undated sorting" }),
  ]);
  redirect.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/ page", () => {
  it("redirects a signed-out visitor to plain /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect(choreFindMany).not.toHaveBeenCalled();
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
    expect(choreFindMany).not.toHaveBeenCalled();
  });

  it("loads the caller's pending chores in their household in one query", async () => {
    await Home();

    expect(choreFindMany).toHaveBeenCalledTimes(1);
    expect(choreFindMany).toHaveBeenCalledWith({
      where: {
        householdId: "household_1",
        status: "pending",
        assignees: { some: { userId: "user_1" } },
      },
      include: {
        category: { select: { name: true } },
        assignees: {
          select: {
            userId: true,
            user: {
              select: {
                name: true,
                email: true,
                memberships: { where: { householdId: "household_1" }, select: { id: true } },
              },
            },
          },
        },
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    });
  });

  it("shows My chores with the New chore and All household chores links", async () => {
    const html = renderToStaticMarkup(await Home());

    expect(html).toContain("My chores");
    expect(html).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/chores"[^>]*>All household chores<\/a>/);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Nothing assigned to you right now.");
  });

  it("renders the rows in query order, the undated chore last", async () => {
    const html = renderToStaticMarkup(await Home());

    const rows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Overdue bins");
    expect(rows[0]).toContain(">Overdue</span>");
    expect(rows[0]).toContain("Assigned to alice@example.com (you)");
    expect(rows[1]).toContain("Upcoming hoovering");
    expect(rows[1]).toContain('<time dateTime="2026-10-25T18:15:00.000Z">25 Oct 2026, 18:15 UTC</time>');
    expect(rows[1]).not.toContain("Overdue");
    expect(rows[1]).toContain("Claimed by alice@example.com (you)");
    expect(rows[2]).toContain("Undated sorting");
    expect(rows[2]).toContain("No due date");
  });

  it("shows the empty state with the All household chores link", async () => {
    choreFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await Home());

    expect(html).toContain("Nothing assigned to you right now.");
    expect(html).toMatch(/<a[^>]*href="\/chores"[^>]*>All household chores<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    expect(html).not.toContain("<li");
  });
});
