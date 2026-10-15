import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user through the real `getCurrentUser()` guard, so the
// session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findUnique } } }));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

// The form is a client component with a Server Action; it is not under test here.
vi.mock("@/app/signup/signup-form", () => ({ SignupForm: () => null }));

const { default: SignupPage } = await import("./page");

function render(callbackUrl?: string | string[]) {
  return SignupPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(callbackUrl === undefined ? {} : { callbackUrl }),
  });
}

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: null };

beforeEach(() => {
  auth.mockReset().mockResolvedValue(null);
  findUnique.mockReset().mockResolvedValue(user);
  redirect.mockClear();
});

describe("/signup page", () => {
  it.each<[string | string[] | undefined, string]>([
    [undefined, "/"],
    ["/invite/abc123", "/invite/abc123"],
    ["//evil.com", "/"],
    [["/invite/a", "/invite/b"], "/"],
  ])("redirects a signed-in user (callbackUrl %j) to %j", async (callbackUrl, target) => {
    auth.mockResolvedValue(session);

    await expect(render(callbackUrl)).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(target);
  });

  it("renders the form for a signed-out visitor", async () => {
    await expect(render("/invite/abc123")).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders the form when the session's user was deleted", async () => {
    auth.mockResolvedValue(session);
    findUnique.mockResolvedValue(null);

    await expect(render("/invite/abc123")).resolves.toBeTruthy();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user_1" } }),
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
