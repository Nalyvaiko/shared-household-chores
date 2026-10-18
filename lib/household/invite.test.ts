import { describe, expect, it } from "vitest";

import {
  activeInviteWhere,
  formatExpiry,
  generateInviteToken,
  inviteStatus,
  inviteUrl,
  isWellFormedInviteToken,
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

describe("isWellFormedInviteToken", () => {
  it("accepts a generated token", () => {
    expect(isWellFormedInviteToken(generateInviteToken())).toBe(true);
    expect(isWellFormedInviteToken("A".repeat(20) + "_-" + "b9".repeat(10) + "z")).toBe(true);
  });

  it.each([
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(44)],
    ["empty", ""],
    ["padding", "a".repeat(42) + "="],
    ["a plus sign", "a".repeat(42) + "+"],
    ["a slash", "a".repeat(42) + "/"],
    ["a dot", "a".repeat(42) + "."],
    ["a percent", "a".repeat(42) + "%"],
    ["a space", "a".repeat(42) + " "],
    ["a trailing newline", "a".repeat(43) + "\n"],
    ["a non-ASCII letter", "a".repeat(42) + "é"],
  ])("rejects %s", (_label, value) => {
    expect(isWellFormedInviteToken(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isWellFormedInviteToken(undefined)).toBe(false);
    expect(isWellFormedInviteToken(null)).toBe(false);
    expect(isWellFormedInviteToken(["a".repeat(43)])).toBe(false);
  });
});

describe("inviteStatus", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const active = {
    householdId: "household_1",
    consumedAt: null,
    expiresAt: new Date("2026-10-23T12:00:00Z"),
  };

  it("is unknown when there is no invite", () => {
    expect(inviteStatus(null, null, now)).toBe("unknown");
    expect(inviteStatus(null, "household_1", now)).toBe("unknown");
  });

  it("is member-here when the caller is in the invite's household, even if used or expired", () => {
    expect(inviteStatus(active, "household_1", now)).toBe("member-here");
    expect(inviteStatus({ ...active, consumedAt: now, expiresAt: now }, "household_1", now)).toBe(
      "member-here",
    );
  });

  it("is other-household when the caller is in a different household, even if used or expired", () => {
    expect(inviteStatus(active, "household_2", now)).toBe("other-household");
    expect(inviteStatus({ ...active, consumedAt: now, expiresAt: now }, "household_2", now)).toBe(
      "other-household",
    );
  });

  it("is used when consumedAt is set, even if also expired", () => {
    expect(inviteStatus({ ...active, consumedAt: now }, null, now)).toBe("used");
    expect(inviteStatus({ ...active, consumedAt: now, expiresAt: now }, null, now)).toBe("used");
  });

  it("is expired at or after expiresAt (a replaced link included)", () => {
    expect(inviteStatus({ ...active, expiresAt: now }, null, now)).toBe("expired");
    expect(inviteStatus({ ...active, expiresAt: new Date(now.getTime() - 1) }, null, now)).toBe(
      "expired",
    );
  });

  it("is valid when unused and expiring after now", () => {
    expect(inviteStatus({ ...active, expiresAt: new Date(now.getTime() + 1) }, null, now)).toBe(
      "valid",
    );
  });
});
