import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them. Every write method is
// a spy so the tests can assert that rendering never writes.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const inviteFindUnique = vi.fn();
const writes = {
  inviteUpdate: vi.fn(),
  inviteUpdateMany: vi.fn(),
  membershipCreate: vi.fn(),
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
};
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst, create: writes.membershipCreate },
    inviteToken: {
      findUnique: inviteFindUnique,
      update: writes.inviteUpdate,
      updateMany: writes.inviteUpdateMany,
    },
    $transaction: writes.$transaction,
    $executeRaw: writes.$executeRaw,
    $queryRaw: writes.$queryRaw,
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { default: InvitePage, metadata } = await import("./page");

const TOKEN = "A".repeat(20) + "_-" + "b".repeat(21);
const session = { user: { id: "user_1", email: "bob@example.com" }, expires: "2099-01-01" };
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

function invite(overrides: { consumedAt?: Date | null; expiresAt?: Date } = {}) {
  return {
    householdId: "household_1",
    consumedAt: null,
    expiresAt: FUTURE,
    household: { name: "Smith Family" },
    ...overrides,
  };
}

function membershipIn(householdId: string, name: string) {
  return {
    id: "membership_9",
    userId: "user_1",
    householdId,
    role: "member",
    household: { id: householdId, name },
  };
}

async function render(token = TOKEN) {
  return renderToStaticMarkup(
    await InvitePage({ params: Promise.resolve({ token }) } as PageProps<"/invite/[token]">),
  );
}

function expectNoWrites() {
  for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "bob@example.com", name: "Bob" });
  membershipFindFirst.mockReset().mockResolvedValue(null);
  inviteFindUnique.mockReset().mockResolvedValue(invite());
  for (const write of Object.values(writes)) write.mockReset();
  redirect.mockClear();
});

describe("/invite/[token] page", () => {
  it("has a title without the household name and is not indexed", () => {
    expect(metadata.title).toBe("Join household · Shared Household Chores");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it.each([
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(44)],
    ["other characters", "a".repeat(42) + "."],
    ["percent-encoded", "a".repeat(40) + "%2F"],
  ])("shows unknown for a %s token without any query or redirect", async (_label, token) => {
    auth.mockResolvedValue(null);

    const html = await render(token);

    expect(html).toContain("Invite link not found");
    expect(auth).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(inviteFindUnique).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects a signed-out visitor to /signin with a callbackUrl, before any token lookup", async () => {
    auth.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(`/signin?callbackUrl=%2Finvite%2F${TOKEN}`);
    expect(inviteFindUnique).not.toHaveBeenCalled();
  });

  it("looks the token up by its value", async () => {
    await render();

    expect(inviteFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: TOKEN } }),
    );
  });

  it("shows unknown when no invite has this token", async () => {
    inviteFindUnique.mockResolvedValue(null);

    const html = await render();

    expect(html).toContain("Invite link not found");
    expect(html).not.toContain("Join household");
    expectNoWrites();
  });

  it("tells a member of this household they're already in it, with a link home", async () => {
    membershipFindFirst.mockResolvedValue(membershipIn("household_1", "Smith Family"));
    inviteFindUnique.mockResolvedValue(invite({ consumedAt: PAST }));

    const html = await render();

    expect(html).toContain("You’re already a member of Smith Family");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("Join household");
    expectNoWrites();
  });

  it("tells a member of another household they can only be in one, without naming this one", async () => {
    membershipFindFirst.mockResolvedValue(membershipIn("household_2", "Jones Flat"));

    const html = await render();

    expect(html).toContain("You already belong to a household");
    expect(html).toContain("only be in one household");
    expect(html).not.toContain("Smith Family");
    expect(html).not.toContain("Join household");
    expectNoWrites();
  });

  it("shows already used when consumedAt is set, without the household name", async () => {
    inviteFindUnique.mockResolvedValue(invite({ consumedAt: PAST }));

    const html = await render();

    expect(html).toContain("Invite link already used");
    expect(html).not.toContain("Smith Family");
    expect(html).not.toContain("Join household");
    expectNoWrites();
  });

  it("shows expired when expiresAt has passed (a replaced link too), without the household name", async () => {
    inviteFindUnique.mockResolvedValue(invite({ expiresAt: PAST }));

    const html = await render();

    expect(html).toContain("Invite link expired");
    expect(html).not.toContain("Smith Family");
    expect(html).not.toContain("Join household");
    expectNoWrites();
  });

  it("shows a valid invite's household name and the Join button, and writes nothing", async () => {
    const html = await render();

    expect(html).toContain("Join Smith Family");
    expect(html).toContain("Join household");
    expect(html).toContain(`name="token" value="${TOKEN}"`);
    expectNoWrites();
  });
});
