import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const membershipFindMany = vi.fn();
const inviteFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst, findMany: membershipFindMany },
    inviteToken: { findFirst: inviteFindFirst },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const requestHeaders = vi.fn();
vi.mock("next/headers", () => ({ headers: requestHeaders }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { default: MembersPage, metadata } = await import("./page");

const TOKEN = "A".repeat(20) + "_-" + "b".repeat(21);
const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Smith Family" };

function callerMembership(role: "admin" | "member") {
  return { id: "membership_1", userId: "user_1", householdId: "household_1", role, household };
}

const rows = [
  { id: "membership_1", role: "admin", user: { name: "Alice", email: "alice@example.com" } },
  { id: "membership_2", role: "member", user: { name: null, email: "bob@example.com" } },
];

async function render() {
  return renderToStaticMarkup(await MembersPage());
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_URL", "");
  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(callerMembership("admin"));
  membershipFindMany.mockReset().mockResolvedValue(rows);
  inviteFindFirst.mockReset().mockResolvedValue({
    token: TOKEN,
    expiresAt: new Date("2026-10-23T14:05:00Z"),
  });
  requestHeaders.mockReset().mockResolvedValue(new Headers({ host: "localhost:3000" }));
  redirect.mockClear();
});

describe("/household/members page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("Members · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin with a callbackUrl back here", async () => {
    auth.mockResolvedValue(null);

    await expect(MembersPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fhousehold%2Fmembers");
  });

  it("redirects a user with no household to /household/new", async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(MembersPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
  });

  it("lists the household's memberships, oldest first", async () => {
    await render();

    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: "household_1" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("shows an admin the list, the invite URL with its expiry, and Remove for others", async () => {
    const html = await render();

    expect(html).toContain("Alice");
    expect(html).toContain("(you)");
    expect(html).toContain("Admin");
    expect(html).toContain("Member");
    expect(html).toContain(`value="http://localhost:3000/invite/${TOKEN}"`);
    expect(html).toContain("readOnly");
    expect(html).toContain("Expires 23 Oct 2026, 14:05 UTC");
    expect(html).toContain("Copy");
    expect(html).toContain("Regenerate link");
    // One Remove button: Bob's row. The caller's own row has none.
    expect(html.match(/>Remove</g)).toHaveLength(1);
  });

  it("loads only an active invite", async () => {
    await render();

    expect(inviteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: "household_1", consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      }),
    );
  });

  it("falls back to the email when the name is null", async () => {
    const html = await render();

    expect(html.match(/bob@example\.com/g)).toHaveLength(2);
  });

  it("shows an admin the create button when there is no active invite", async () => {
    inviteFindFirst.mockResolvedValue(null);

    const html = await render();

    expect(html).toContain("No active invite link");
    expect(html).toContain("Create invite link");
    expect(html).not.toContain("/invite/");
  });

  it("builds the invite URL on AUTH_URL when it is set", async () => {
    vi.stubEnv("AUTH_URL", "https://chores.example.com");

    const html = await render();

    expect(html).toContain(`https://chores.example.com/invite/${TOKEN}`);
  });

  it("shows a member the list only, with no invite section, token, or Remove buttons", async () => {
    membershipFindFirst.mockResolvedValue(callerMembership("member"));

    const html = await render();

    expect(html).toContain("Alice");
    expect(html).toContain("bob@example.com");
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("/invite/");
    expect(html).not.toContain("Invite link");
    expect(html).not.toContain("Create invite link");
    expect(html).not.toContain(">Remove<");
    expect(inviteFindFirst).not.toHaveBeenCalled();
  });
});
