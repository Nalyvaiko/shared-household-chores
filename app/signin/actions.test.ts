import { CredentialsSignin } from "@auth/core/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INVALID_CREDENTIALS_ERROR } from "@/lib/auth/validation";

const signIn = vi.fn();
vi.mock("@/auth", () => ({ signIn }));

// The real "next-auth" entry imports "next/server", which does not resolve
// outside Next.js. Its error classes are re-exported from "@auth/core/errors".
vi.mock("next-auth", () => import("@auth/core/errors"));

const { signin } = await import("./actions");

const PASSWORD = "  correct horse  ";

function submit(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return signin({ email: "" }, data);
}

beforeEach(() => {
  signIn.mockReset().mockResolvedValue(undefined);
});

describe("signin", () => {
  it("signs in with the normalised email, the unchanged password and a safe redirectTo", async () => {
    await submit({
      email: "  Alice@Example.COM ",
      password: PASSWORD,
      callbackUrl: "/invite/abc123",
    });

    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "alice@example.com",
      password: PASSWORD,
      redirectTo: "/invite/abc123",
    });
  });

  it("redirects to / when there is no callbackUrl", async () => {
    await submit({ email: "alice@example.com", password: PASSWORD });

    expect(signIn.mock.calls[0][1].redirectTo).toBe("/");
  });

  it.each(["//evil.com", "https://evil.com", "/\t/evil.com", "javascript:alert(1)"])(
    "never trusts the hidden callbackUrl %j",
    async (callbackUrl) => {
      await submit({ email: "alice@example.com", password: PASSWORD, callbackUrl });

      expect(signIn.mock.calls[0][1].redirectTo).toBe("/");
    },
  );

  it("lets the signIn redirect propagate instead of swallowing it", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    signIn.mockRejectedValue(redirect);

    await expect(submit({ email: "alice@example.com", password: PASSWORD })).rejects.toBe(
      redirect,
    );
  });

  it("shows the generic message for CredentialsSignin, keeps the email, drops the password", async () => {
    signIn.mockRejectedValue(new CredentialsSignin());

    const state = await submit({ email: "Alice@Example.com", password: "Zq9!xYsecret" });

    expect(state).toEqual({ email: "Alice@Example.com", error: INVALID_CREDENTIALS_ERROR });
    expect(JSON.stringify(state)).not.toContain("Zq9!xYsecret");
  });

  it.each([
    ["an empty email", { email: "", password: PASSWORD }],
    ["a blank email", { email: "   ", password: PASSWORD }],
    ["an empty password", { email: "alice@example.com", password: "" }],
    ["missing fields", {}],
  ])("shows the generic message for %s without calling signIn", async (_label, fields) => {
    const state = await submit(fields);

    expect(state.error).toBe(INVALID_CREDENTIALS_ERROR);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not apply the sign-up rules (a short password still goes to signIn)", async () => {
    signIn.mockRejectedValue(new CredentialsSignin());

    const state = await submit({ email: "not-an-email", password: "123" });

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(state.error).toBe(INVALID_CREDENTIALS_ERROR);
  });

  it("rethrows unrelated errors instead of reporting invalid credentials", async () => {
    const failure = new Error("connection lost");
    signIn.mockRejectedValue(failure);

    await expect(submit({ email: "alice@example.com", password: PASSWORD })).rejects.toBe(
      failure,
    );
  });
});
