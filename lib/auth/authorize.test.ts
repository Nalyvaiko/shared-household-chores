import { hashSync } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findUnique } } }));

const { authorizeCredentials } = await import("./authorize");

// Low cost keeps the suite fast; `compare` reads the cost from the hash.
const storedUser = {
  id: "user_1",
  email: "alice@example.com",
  name: null,
  passwordHash: hashSync("correct horse", 4),
};

beforeEach(() => {
  findUnique.mockReset();
});

describe("authorizeCredentials", () => {
  it("returns the user for the correct password", async () => {
    findUnique.mockResolvedValue(storedUser);

    const user = await authorizeCredentials({
      email: "alice@example.com",
      password: "correct horse",
    });

    expect(user).toEqual({ id: "user_1", email: "alice@example.com", name: null });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("normalises the submitted email before the lookup", async () => {
    findUnique.mockResolvedValue(storedUser);

    await authorizeCredentials({
      email: "  Alice@Example.COM ",
      password: "correct horse",
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "alice@example.com" } }),
    );
  });

  it("returns null for a wrong password", async () => {
    findUnique.mockResolvedValue(storedUser);

    await expect(
      authorizeCredentials({ email: "alice@example.com", password: "wrong horse" }),
    ).resolves.toBeNull();
  });

  it("returns null for an unknown email", async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      authorizeCredentials({ email: "nobody@example.com", password: "correct horse" }),
    ).resolves.toBeNull();
  });

  it("returns null for missing or non-string credentials without querying", async () => {
    await expect(authorizeCredentials(undefined)).resolves.toBeNull();
    await expect(authorizeCredentials({ email: "a@example.com" })).resolves.toBeNull();
    await expect(
      authorizeCredentials({ email: 1, password: "correct horse" }),
    ).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null for a password over 72 bytes, even when its first 72 bytes match", async () => {
    const password72 = "p".repeat(72);
    findUnique.mockResolvedValue({ ...storedUser, passwordHash: hashSync(password72, 4) });

    // bcrypt alone would accept this: it ignores everything after byte 72.
    await expect(
      authorizeCredentials({ email: "alice@example.com", password: password72 }),
    ).resolves.toEqual({ id: "user_1", email: "alice@example.com", name: null });
    findUnique.mockClear();

    await expect(
      authorizeCredentials({ email: "alice@example.com", password: `${password72}extra` }),
    ).resolves.toBeNull();
    // 36 x "é" is 72 bytes; one more character pushes it over.
    await expect(
      authorizeCredentials({ email: "alice@example.com", password: "é".repeat(37) }),
    ).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
