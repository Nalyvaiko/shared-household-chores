import { describe, expect, it } from "vitest";

import { nextDueAt } from "@/lib/chore/recurrence";

const NOW = new Date("2026-10-23T12:00:00.000Z");

function next(recurrence: "daily" | "weekly" | "monthly", previous: string | null): string {
  return nextDueAt(recurrence, previous === null ? null : new Date(previous), NOW).toISOString();
}

describe("nextDueAt", () => {
  it("adds one UTC day for daily", () => {
    expect(next("daily", "2026-10-20T09:30:00.000Z")).toBe("2026-10-21T09:30:00.000Z");
    expect(next("daily", "2026-12-31T23:59:59.999Z")).toBe("2027-01-01T23:59:59.999Z");
  });

  it("adds seven UTC days for weekly", () => {
    expect(next("weekly", "2026-10-20T09:30:00.000Z")).toBe("2026-10-27T09:30:00.000Z");
    expect(next("weekly", "2026-02-25T08:00:00.000Z")).toBe("2026-03-04T08:00:00.000Z");
  });

  it("adds one calendar month for monthly", () => {
    expect(next("monthly", "2026-10-20T09:30:00.000Z")).toBe("2026-11-20T09:30:00.000Z");
  });

  it.each([
    ["Jan 31 to Feb 28 in a common year", "2027-01-31T10:00:00.000Z", "2027-02-28T10:00:00.000Z"],
    ["Jan 31 to Feb 29 in a leap year", "2028-01-31T10:00:00.000Z", "2028-02-29T10:00:00.000Z"],
    ["Mar 31 to Apr 30", "2027-03-31T10:00:00.000Z", "2027-04-30T10:00:00.000Z"],
    ["Dec 31 to Jan 31 of the next year", "2026-12-31T10:00:00.000Z", "2027-01-31T10:00:00.000Z"],
  ])("clamps monthly to the last day of the target month: %s", (_label, previous, expected) => {
    expect(next("monthly", previous)).toBe(expected);
  });

  it("anchors monthly to the previous due date, so a clamped series stays on the 28th", () => {
    expect(next("monthly", "2027-02-28T10:00:00.000Z")).toBe("2027-03-28T10:00:00.000Z");
  });

  it.each(["daily", "weekly", "monthly"] as const)(
    "keeps the UTC time of day to the millisecond for %s",
    (recurrence) => {
      expect(next(recurrence, "2026-03-28T23:45:12.345Z")).toMatch(/T23:45:12\.345Z$/);
    },
  );

  it("is not shifted by a DST change (UTC math only)", () => {
    // Europe and the US change clocks around these dates; UTC does not.
    expect(next("weekly", "2026-03-25T08:00:00.000Z")).toBe("2026-04-01T08:00:00.000Z");
    expect(next("daily", "2026-10-24T08:00:00.000Z")).toBe("2026-10-25T08:00:00.000Z");
  });

  it.each([
    ["daily", "2026-10-24T12:00:00.000Z"],
    ["weekly", "2026-10-30T12:00:00.000Z"],
    ["monthly", "2026-11-23T12:00:00.000Z"],
  ] as const)("uses now as the base when there was no due date (%s)", (recurrence, expected) => {
    expect(next(recurrence, null)).toBe(expected);
  });

  it("takes exactly one step from a past base, even if the result is still past", () => {
    // Three weeks late: one week on is still before now.
    const result = nextDueAt("weekly", new Date("2026-10-02T12:00:00.000Z"), NOW);
    expect(result.toISOString()).toBe("2026-10-09T12:00:00.000Z");
    expect(result.getTime()).toBeLessThan(NOW.getTime());
  });

  it("does not stop at the form's 2099 limit", () => {
    expect(next("monthly", "2099-12-31T10:00:00.000Z")).toBe("2100-01-31T10:00:00.000Z");
  });

  it("does not modify the given dates", () => {
    const previous = new Date("2026-10-20T09:30:00.000Z");
    const now = new Date(NOW);
    nextDueAt("monthly", previous, now);
    nextDueAt("daily", null, now);
    expect(previous.toISOString()).toBe("2026-10-20T09:30:00.000Z");
    expect(now.toISOString()).toBe(NOW.toISOString());
  });
});
