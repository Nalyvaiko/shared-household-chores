import { describe, expect, it } from "vitest";

import {
  DUE_AT_INVALID_MARKER,
  DUE_AT_OUT_OF_RANGE_MARKER,
  localToUtcIso,
} from "@/lib/chore/due-date";

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

  it.each([
    "0001-03-10T09:30",
    "1998-12-31T23:59",
    "2101-01-01T00:00",
    "9999-12-31T23:59",
    "100000-03-10T09:30",
    // The input's maximum, past the largest Date west of UTC.
    "275760-09-13T00:00",
    "275760-09-12T18:00",
  ])("gives the out-of-range marker for %s in any time zone", (local) => {
    expect(DUE_AT_OUT_OF_RANGE_MARKER).toBe("out-of-range");
    expect(localToUtcIso(local)).toBe("out-of-range");
  });

  it.each(["1999-12-31T23:59", "2100-01-01T00:00"])(
    "converts the edge year %s, which some zones put in range, for the server to check",
    (local) => {
      expect(localToUtcIso(local)).toBe(new Date(local).toISOString());
    },
  );

  it("gives the invalid marker for a value Date can't read", () => {
    expect(localToUtcIso("not a date")).toBe("invalid");
  });
});
