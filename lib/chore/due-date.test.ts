import { describe, expect, it } from "vitest";

import { DUE_AT_INVALID_MARKER, localToUtcIso } from "@/lib/chore/due-date";

describe("localToUtcIso", () => {
  it("converts a local date and time to the UTC instant in this machine's zone", () => {
    // Built the same way, so the test holds in any time zone.
    expect(localToUtcIso("2026-03-10T09:30")).toBe(new Date(2026, 2, 10, 9, 30).toISOString());
  });

  it("writes a strict UTC ISO value ending in Z", () => {
    expect(localToUtcIso("2026-03-10T09:30")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("gives an empty value for an empty input", () => {
    expect(localToUtcIso("")).toBe("");
  });

  it("gives the invalid marker when the browser reports bad input", () => {
    expect(DUE_AT_INVALID_MARKER).toBe("invalid");
    // A half-filled datetime-local input reads as "" with validity.badInput.
    expect(localToUtcIso("", true)).toBe("invalid");
    expect(localToUtcIso("2026-03-10T09:30", true)).toBe("invalid");
  });

  it("still converts the six-digit years datetime-local allows, for the server's range check", () => {
    const expected = new Date(2026, 2, 10, 9, 30);
    expected.setFullYear(100000);
    expect(localToUtcIso("100000-03-10T09:30")).toBe(expected.toISOString());
    expect(localToUtcIso("100000-03-10T09:30")).toMatch(/^\+100000-/);
  });

  it("gives the invalid marker for a value Date can't read", () => {
    expect(localToUtcIso("not a date")).toBe("invalid");
  });
});
