import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The header resolves the user and household through the real helpers, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth, signOut: vi.fn() }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst },
  },
}));

const { SiteHeader } = await import("./site-header");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };

function callerMembership(name: string) {
  return {
    id: "membership_1",
    userId: "user_1",
    householdId: "household_1",
    role: "member",
    household: { id: "household_1", name },
  };
}

async function render() {
  return renderToStaticMarkup(await SiteHeader());
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  userFindUnique
    .mockReset()
    .mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(callerMembership("Smith Family"));
});

describe("SiteHeader", () => {
  it("shows the household name, truncated, to a signed-in user with a household", async () => {
    const html = await render();

    expect(html).toMatch(
      /<span class="[^"]*\btruncate\b[^"]*" title="Smith Family">Smith Family<\/span>/,
    );
    expect(html).toContain("alice@example.com");
  });

  it("shows whatever name the database has now, so a rename shows up", async () => {
    membershipFindFirst.mockResolvedValue(callerMembership("Flat 4"));

    const html = await render();

    expect(html).toContain(">Flat 4<");
    expect(html).not.toContain("Smith Family");
  });

  it("shows no household name to a signed-in user without a household", async () => {
    membershipFindFirst.mockResolvedValue(null);

    const html = await render();

    expect(html).not.toContain("title=");
    expect(html).toContain("alice@example.com");
  });

  it("shows the sign-in links and no household name when signed out", async () => {
    auth.mockResolvedValue(null);

    const html = await render();

    expect(html).toContain(">Sign in<");
    expect(html).not.toContain("title=");
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });
});
