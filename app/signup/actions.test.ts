import { Prisma } from "@prisma/client";
import { compareSync, getRounds } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMAIL_ERROR,
  EMAIL_TAKEN_ERROR,
  PASSWORD_TOO_LONG_ERROR,
  PASSWORD_TOO_SHORT_ERROR,
} from "@/lib/auth/validation";

const findUnique = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findUnique, create } } }));

const signIn = vi.fn();
vi.mock("@/auth", () => ({ signIn }));

const { signup } = await import("./actions");

const PASSWORD = "correct horse battery";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function submit(fields: Record<string, string>) {
  return signup({ email: "" }, form(fields));
}

function p2002(target: unknown = ["email"]) {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`email`)",
    { code: "P2002", clientVersion: Prisma.prismaVersion.client, meta: { target } },
  );
}

function expectNothingCreated() {
  expect(create).not.toHaveBeenCalled();
  expect(signIn).not.toHaveBeenCalled();
}

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(null);
  create.mockReset().mockResolvedValue({ id: "user_1" });
  signIn.mockReset().mockResolvedValue(undefined);
});

describe("signup", () => {
  it("creates the user with a bcrypt hash (cost >= 12) and signs in", async () => {
    const state = await submit({ email: "alice@example.com", password: PASSWORD });

    expect(state.errors).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    const { data } = create.mock.calls[0][0];
    expect(data.email).toBe("alice@example.com");
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("password");
    expect(data.passwordHash).not.toBe(PASSWORD);
    expect(data.passwordHash).not.toContain(PASSWORD);
    expect(getRounds(data.passwordHash)).toBeGreaterThanOrEqual(12);
    expect(compareSync(PASSWORD, data.passwordHash)).toBe(true);

    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "alice@example.com",
      password: PASSWORD,
      redirectTo: "/",
    });
  });

  it("redirects to a safe callbackUrl after signing in", async () => {
    await submit({
      email: "alice@example.com",
      password: PASSWORD,
      callbackUrl: "/invite/abc123",
    });

    expect(signIn.mock.calls[0][1].redirectTo).toBe("/invite/abc123");
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "/\t/evil.com"])(
    "never trusts the hidden callbackUrl %j",
    async (callbackUrl) => {
      await submit({ email: "alice@example.com", password: PASSWORD, callbackUrl });

      expect(signIn.mock.calls[0][1].redirectTo).toBe("/");
    },
  );

  it("never returns the password in the form state", async () => {
    const state = await submit({ email: "alice@example.com", password: "Zq9!xY" });

    expect(JSON.stringify(state)).not.toContain("Zq9!xY");
    expect(state).toEqual({
      email: "alice@example.com",
      errors: { email: undefined, password: [PASSWORD_TOO_SHORT_ERROR] },
    });
  });

  it("lets the signIn redirect propagate instead of swallowing it", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    signIn.mockRejectedValue(redirect);

    await expect(
      submit({ email: "alice@example.com", password: PASSWORD }),
    ).rejects.toBe(redirect);
  });

  it("normalises the email before the uniqueness check and storing", async () => {
    await submit({ email: "  Alice@Example.COM ", password: PASSWORD });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "alice@example.com" } }),
    );
    expect(create.mock.calls[0][0].data.email).toBe("alice@example.com");
  });

  it("does not trim or alter the password", async () => {
    const padded = "  spaced password  ";
    await submit({ email: "alice@example.com", password: padded });

    const { passwordHash } = create.mock.calls[0][0].data;
    expect(compareSync(padded, passwordHash)).toBe(true);
    expect(compareSync(padded.trim(), passwordHash)).toBe(false);
    expect(signIn.mock.calls[0][1].password).toBe(padded);
  });

  it.each([
    ["malformed", "not-an-email"],
    ["empty", ""],
    ["blank", "   "],
  ])("rejects a %s email and keeps what was entered", async (_label, email) => {
    const state = await submit({ email, password: PASSWORD });

    expect(state.email).toBe(email);
    expect(state.errors?.email).toEqual([EMAIL_ERROR]);
    expect(findUnique).not.toHaveBeenCalled();
    expectNothingCreated();
  });

  it.each([
    ["under 8 bytes", "1234567"],
    ["empty", ""],
  ])("rejects a password %s", async (_label, password) => {
    const state = await submit({ email: "alice@example.com", password });

    expect(state.errors?.password).toEqual([PASSWORD_TOO_SHORT_ERROR]);
    expectNothingCreated();
  });

  it("rejects missing form fields", async () => {
    const state = await signup({ email: "" }, new FormData());

    expect(state.errors?.email).toEqual([EMAIL_ERROR]);
    expect(state.errors?.password).toEqual([PASSWORD_TOO_SHORT_ERROR]);
    expectNothingCreated();
  });

  it("accepts a password of exactly 72 bytes", async () => {
    const state = await submit({ email: "alice@example.com", password: "a".repeat(72) });

    expect(state.errors).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects a password over 72 bytes", async () => {
    const state = await submit({ email: "alice@example.com", password: "a".repeat(73) });

    expect(state.errors?.password).toEqual([PASSWORD_TOO_LONG_ERROR]);
    expectNothingCreated();
  });

  it("counts UTF-8 bytes, not characters", async () => {
    // 37 x "é" is 37 characters but 74 bytes; 4 x "é" is 8 bytes.
    const tooLong = await submit({ email: "alice@example.com", password: "é".repeat(37) });
    expect(tooLong.errors?.password).toEqual([PASSWORD_TOO_LONG_ERROR]);

    const longEnough = await submit({ email: "alice@example.com", password: "é".repeat(4) });
    expect(longEnough.errors).toBeUndefined();
  });

  it("rejects an already registered email (pre-check)", async () => {
    findUnique.mockResolvedValue({ id: "existing" });

    const state = await submit({ email: "Alice@example.com", password: PASSWORD });

    expect(state).toEqual({
      email: "Alice@example.com",
      errors: { email: [EMAIL_TAKEN_ERROR] },
    });
    expectNothingCreated();
  });

  it("shows the same message when a concurrent signup wins the race (P2002)", async () => {
    create.mockRejectedValue(p2002());

    const state = await submit({ email: "alice@example.com", password: PASSWORD });

    expect(state).toEqual({
      email: "alice@example.com",
      errors: { email: [EMAIL_TAKEN_ERROR] },
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("rethrows other database errors", async () => {
    const failure = new Error("connection lost");
    create.mockRejectedValue(failure);

    await expect(
      submit({ email: "alice@example.com", password: PASSWORD }),
    ).rejects.toBe(failure);
    expect(signIn).not.toHaveBeenCalled();
  });
});
