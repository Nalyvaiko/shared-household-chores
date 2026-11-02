import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { default: HouseholdSettingsPage, metadata } = await import("./page");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Smith Family" };

function callerMembership(role: "admin" | "member") {
  return { id: "membership_1", userId: "user_1", householdId: "household_1", role, household };
}

async function render() {
  return renderToStaticMarkup(await HouseholdSettingsPage());
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  userFindUnique
    .mockReset()
    .mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(callerMembership("admin"));
  redirect.mockClear();
});

describe("/household/settings page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("Household settings · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin with a callbackUrl back here", async () => {
    auth.mockResolvedValue(null);

    await expect(HouseholdSettingsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fhousehold%2Fsettings");
  });

  it("redirects a user with no household to /household/new", async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(HouseholdSettingsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
  });

  it("gives an admin the rename form, filled with the current name", async () => {
    const html = await render();

    expect(html).toContain("Household settings");
    expect(html).toMatch(/<form/);
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Smith Family"/);
    expect(html).toContain(">Save<");
    expect(html).not.toMatch(/maxLength|maxlength/);
    expect(html).not.toContain("Only a household admin can rename the household.");
  });

  it("shows a member the current name read-only, with no form", async () => {
    membershipFindFirst.mockResolvedValue(callerMembership("member"));

    const html = await render();

    expect(html).toContain("<dd");
    expect(html).toContain("Smith Family");
    expect(html).toContain("Only a household admin can rename the household.");
    expect(html).not.toMatch(/<form/);
    expect(html).not.toMatch(/<input/);
    expect(html).not.toContain(">Save<");
  });
});
