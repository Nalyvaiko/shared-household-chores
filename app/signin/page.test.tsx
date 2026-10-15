import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

// The form is a client component with a Server Action; it is not under test here.
vi.mock("@/app/signin/signin-form", () => ({ SigninForm: () => null }));

const { default: SigninPage } = await import("./page");

function render(callbackUrl?: string | string[]) {
  return SigninPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(callbackUrl === undefined ? {} : { callbackUrl }),
  });
}

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };

beforeEach(() => {
  auth.mockReset().mockResolvedValue(null);
  redirect.mockClear();
});

describe("/signin page", () => {
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
});
