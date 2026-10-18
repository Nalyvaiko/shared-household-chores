import { describe, expect, it } from "vitest";

import {
  activeInviteWhere,
  formatExpiry,
  generateInviteToken,
  inviteUrl,
  resolveOrigin,
} from "./invite";

function headersOf(values: Record<string, string>) {
  return new Headers(values);
}

describe("generateInviteToken", () => {
  it("returns 43 URL-safe characters, different each time", () => {
    const first = generateInviteToken();
    const second = generateInviteToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });
});

describe("activeInviteWhere", () => {
  it("matches unconsumed invites that expire after now", () => {
    const now = new Date("2026-10-16T12:00:00Z");

    expect(activeInviteWhere("household_1", now)).toEqual({
      householdId: "household_1",
      consumedAt: null,
      expiresAt: { gt: now },
    });
  });
});

describe("resolveOrigin", () => {
  const proxied = headersOf({
    host: "internal:3000",
    "x-forwarded-host": "chores.example.com",
    "x-forwarded-proto": "https",
  });

  it("uses the origin of AUTH_URL when it is set", () => {
    expect(resolveOrigin(proxied, "https://app.example.org/api/auth")).toBe(
      "https://app.example.org",
    );
  });

  it("ignores an AUTH_URL that is not a URL", () => {
    expect(resolveOrigin(proxied, "not a url")).toBe("https://chores.example.com");
  });

  it("uses the forwarded proto and host when AUTH_URL is not set", () => {
    expect(resolveOrigin(proxied, undefined)).toBe("https://chores.example.com");
  });

  it("takes the first value of a comma-separated forwarded header", () => {
    const headers = headersOf({
      "x-forwarded-host": "a.example.com, b.example.com",
      "x-forwarded-proto": "https,http",
    });

    expect(resolveOrigin(headers, undefined)).toBe("https://a.example.com");
  });

  it("falls back to host and http", () => {
    expect(resolveOrigin(headersOf({ host: "localhost:3000" }), undefined)).toBe(
      "http://localhost:3000",
    );
  });

  it("uses the forwarded proto with the host header", () => {
    const headers = headersOf({ host: "localhost:3000", "x-forwarded-proto": "https" });

    expect(resolveOrigin(headers, undefined)).toBe("https://localhost:3000");
  });

  it("returns an empty origin when there is no host at all", () => {
    expect(resolveOrigin(headersOf({}), undefined)).toBe("");
  });

  it("builds the invite URL on the origin", () => {
    expect(inviteUrl("http://localhost:3000", "abc")).toBe("http://localhost:3000/invite/abc");
  });
});

describe("formatExpiry", () => {
  it("shows the date and time in UTC with the timezone", () => {
    expect(formatExpiry(new Date("2026-10-23T14:05:00Z"))).toBe("23 Oct 2026, 14:05 UTC");
  });

  it("does not shift with the server's local timezone", () => {
    expect(formatExpiry(new Date("2026-12-31T23:30:00Z"))).toBe("31 Dec 2026, 23:30 UTC");
  });
});
