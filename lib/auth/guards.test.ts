import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique },
    membership: { findFirst },
  },
}));

// Like the real one, `redirect` throws so the caller stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const {
  ForbiddenError,
  getCurrentHousehold,
  getCurrentUser,
  requireAdmin,
  requireHousehold,
  requireUser,
} = await import("./guards");

const session = { user: { id: "user_1", email: "old@example.com" }, expires: "2099-01-01" };
const userRow = { id: "user_1", email: "alice@example.com", name: "Alice" };
const household = {
  id: "household_1",
  name: "Flat 4",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

function membership(role: "admin" | "member") {
  return {
    id: "membership_1",
    userId: "user_1",
    householdId: "household_1",
    role,
    createdAt: new Date("2026-01-01"),
  };
}

// What `findFirst` with `include: { household: true }` returns.
function membershipRow(role: "admin" | "member") {
  return { ...membership(role), household };
}

// The mocked Prisma client honours `select`, so a test can check that
// `passwordHash` never leaves the query.
const fullUserRow = { ...userRow, passwordHash: "$2b$10$hash" };

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockImplementation(
    async ({ select }: { select?: Record<string, boolean> }) =>
      select
        ? Object.fromEntries(
            Object.entries(fullUserRow).filter(([key]) => select[key]),
          )
        : fullUserRow,
  );
  findFirst.mockReset().mockResolvedValue(membershipRow("admin"));
  redirect.mockClear();
});

function signedOut() {
  auth.mockResolvedValue(null);
}

function deletedUser() {
  findUnique.mockResolvedValue(null);
}

describe("getCurrentUser", () => {
  it("returns the database row's id, email and name without passwordHash", async () => {
    const user = await getCurrentUser();

    expect(user).toEqual(userRow);
    expect(user).not.toHaveProperty("passwordHash");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: { id: true, email: true, name: true },
    });
  });

  it("returns null when there is no session", async () => {
    signedOut();

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the session has no user id", async () => {
    auth.mockResolvedValue({ user: { email: "alice@example.com" }, expires: "2099-01-01" });

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the session's user was deleted", async () => {
    deletedUser();

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("requireUser", () => {
  it("returns the current user", async () => {
    await expect(requireUser()).resolves.toEqual(userRow);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /signin when there is no session", async () => {
    signedOut();

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
  });

  it("redirects to /signin when the session's user was deleted", async () => {
    deletedUser();

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
  });

  it.each<[string, string]>([
    ["/invite/abc123", "/signin?callbackUrl=%2Finvite%2Fabc123"],
    ["//evil.com", "/signin"],
    ["/", "/signin"],
  ])("carries callbackUrl %j as %j", async (callbackUrl, target) => {
    signedOut();

    await expect(requireUser({ callbackUrl })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(target);
  });
});

describe("getCurrentHousehold", () => {
  it("returns the household and membership", async () => {
    await expect(getCurrentHousehold()).resolves.toEqual({
      household,
      membership: membership("admin"),
    });
  });

  it("queries the membership of the session user", async () => {
    await getCurrentHousehold();

    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      include: { household: true },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns null when the user has no membership", async () => {
    findFirst.mockResolvedValue(null);

    await expect(getCurrentHousehold()).resolves.toBeNull();
  });

  it("returns null without querying memberships when there is no session", async () => {
    signedOut();

    await expect(getCurrentHousehold()).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("requireHousehold", () => {
  it("returns the household and membership", async () => {
    await expect(requireHousehold()).resolves.toEqual({
      household,
      membership: membership("admin"),
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } }),
    );
  });

  it("redirects to /household/new when the user has no membership", async () => {
    findFirst.mockResolvedValue(null);

    await expect(requireHousehold()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
  });

  it("redirects to /signin without querying memberships when there is no session", async () => {
    signedOut();

    await expect(requireHousehold()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("redirects to /signin when the session's user was deleted", async () => {
    deletedUser();

    await expect(requireHousehold()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  it("returns the household and membership for an admin", async () => {
    await expect(requireAdmin()).resolves.toEqual({
      household,
      membership: membership("admin"),
    });
  });

  it("throws ForbiddenError for a member", async () => {
    findFirst.mockResolvedValue(membershipRow("member"));

    const result = requireAdmin();
    await expect(result).rejects.toBeInstanceOf(ForbiddenError);
    await expect(result).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /signin when there is no session", async () => {
    signedOut();

    const result = requireAdmin();
    await expect(result).rejects.toThrow("NEXT_REDIRECT");
    await expect(result).rejects.not.toBeInstanceOf(ForbiddenError);
    expect(redirect).toHaveBeenCalledWith("/signin");
  });

  it("redirects to /household/new when the user has no household", async () => {
    findFirst.mockResolvedValue(null);

    const result = requireAdmin();
    await expect(result).rejects.toThrow("NEXT_REDIRECT");
    await expect(result).rejects.not.toBeInstanceOf(ForbiddenError);
    expect(redirect).toHaveBeenCalledWith("/household/new");
  });
});

describe("ForbiddenError", () => {
  it("is an Error named ForbiddenError", () => {
    const error = new ForbiddenError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ForbiddenError");
  });
});
