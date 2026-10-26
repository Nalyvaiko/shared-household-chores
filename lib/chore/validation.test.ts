import { describe, expect, it } from "vitest";

import {
  CHORE_ASSIGNMENT_MODE_ERROR,
  CHORE_EFFORT_ERROR,
  CHORE_PRIORITY_ERROR,
  CHORE_RECURRENCE_ERROR,
  CHORE_TITLE_CONTROL_ERROR,
  CHORE_TITLE_EMPTY_ERROR,
  CHORE_TITLE_TOO_LONG_ERROR,
  DUE_AT_INVALID_ERROR,
  DUE_AT_RANGE_ERROR,
  DUE_AT_TIME_ZONE_ERROR,
  SKIP_REASON_CONTROL_ERROR,
  SKIP_REASON_EMPTY_ERROR,
  SKIP_REASON_TOO_LONG_ERROR,
  assignmentModeSchema,
  choreTitleSchema,
  effortSchema,
  parseDueAt,
  prioritySchema,
  recurrenceSchema,
  skipReasonSchema,
} from "@/lib/chore/validation";

function titleErrors(value: unknown): string[] {
  const parsed = choreTitleSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("choreTitleSchema", () => {
  it("trims both ends and keeps inner spaces as typed", () => {
    expect(choreTitleSchema.parse("  Take  out the bins \t")).toBe("Take  out the bins");
  });

  it.each(["", "   ", "\t \n"])("rejects an empty title (%j)", (value) => {
    expect(titleErrors(value)).toEqual([CHORE_TITLE_EMPTY_ERROR]);
  });

  it("rejects a non-string with the empty message", () => {
    expect(titleErrors(undefined)).toEqual([CHORE_TITLE_EMPTY_ERROR]);
  });

  it.each([
    ["a newline", "Take out\nthe bins"],
    ["a carriage return", "Take out\rthe bins"],
    ["a tab", "Take out\tthe bins"],
    ["NUL", "Bins\u0000"],
    ["DEL", "Bins\u007f"],
    ["U+0085 (NEL)", "Bins\u0085now"],
    ["U+009F", "Bins\u009f"],
  ])("rejects %s inside the title", (_label, value) => {
    expect(titleErrors(value)).toEqual([CHORE_TITLE_CONTROL_ERROR]);
  });

  it("accepts 120 code points, including 120 emoji (240 UTF-16 units)", () => {
    expect(titleErrors("a".repeat(120))).toEqual([]);
    expect(choreTitleSchema.parse("🧹".repeat(120))).toBe("🧹".repeat(120));
  });

  it("rejects 121 code points, including 121 emoji", () => {
    expect(titleErrors("a".repeat(121))).toEqual([CHORE_TITLE_TOO_LONG_ERROR]);
    expect(titleErrors("🧹".repeat(121))).toEqual([CHORE_TITLE_TOO_LONG_ERROR]);
  });

  it("counts the length after trimming", () => {
    expect(titleErrors(`  ${"a".repeat(120)}  `)).toEqual([]);
  });
});

describe("prioritySchema and effortSchema", () => {
  it.each(["low", "medium", "high", "urgent"])("accepts the priority %j", (value) => {
    expect(prioritySchema.parse(value)).toBe(value);
  });

  it.each(["", "URGENT", "critical", " low", undefined, null])(
    "rejects the priority %j",
    (value) => {
      const parsed = prioritySchema.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([CHORE_PRIORITY_ERROR]);
    },
  );

  it.each(["small", "medium", "large"])("accepts the effort %j", (value) => {
    expect(effortSchema.parse(value)).toBe(value);
  });

  it.each(["", "LARGE", "huge", "urgent", undefined])("rejects the effort %j", (value) => {
    const parsed = effortSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([CHORE_EFFORT_ERROR]);
  });
});

describe("recurrenceSchema and assignmentModeSchema", () => {
  it.each(["none", "daily", "weekly", "monthly"])("accepts the recurrence %j", (value) => {
    expect(recurrenceSchema.parse(value)).toBe(value);
  });

  it.each(["", "DAILY", "yearly", " none", undefined, null])(
    "rejects the recurrence %j instead of defaulting it",
    (value) => {
      const parsed = recurrenceSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([CHORE_RECURRENCE_ERROR]);
    },
  );

  it.each(["fixed", "claim"])("accepts the assignment mode %j", (value) => {
    expect(assignmentModeSchema.parse(value)).toBe(value);
  });

  it.each(["", "FIXED", "rotate", undefined, null])(
    "rejects the assignment mode %j instead of defaulting it",
    (value) => {
      const parsed = assignmentModeSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
        CHORE_ASSIGNMENT_MODE_ERROR,
      ]);
    },
  );
});

describe("parseDueAt", () => {
  it("gives null when both fields are empty", () => {
    expect(parseDueAt("", "")).toEqual({ success: true, dueAt: null });
  });

  it("gives the Date for a valid UTC ISO value", () => {
    expect(parseDueAt("2026-03-10T07:30:00.000Z", "2026-03-10T09:30")).toEqual({
      success: true,
      dueAt: new Date("2026-03-10T07:30:00.000Z"),
    });
  });

  it("accepts a past date inside the range", () => {
    expect(parseDueAt("2001-06-01T12:00:00.000Z", "2001-06-01T14:00")).toEqual({
      success: true,
      dueAt: new Date("2001-06-01T12:00:00.000Z"),
    });
  });

  it.each([
    ["the invalid marker", "invalid"],
    ["garbage", "next tuesday"],
    ["an offset instead of Z", "2026-03-10T09:30:00+02:00"],
    ["no zone at all", "2026-03-10T09:30:00"],
    ["a date only", "2026-03-10"],
    ["an impossible day", "2026-02-30T07:30:00.000Z"],
    ["surrounding spaces", " 2026-03-10T07:30:00.000Z "],
  ])("rejects %s", (_label, value) => {
    expect(parseDueAt(value, "2026-03-10T09:30")).toEqual({
      success: false,
      error: DUE_AT_INVALID_ERROR,
    });
  });

  it.each([
    ["1999-12-31T23:59:59.999Z", false],
    ["2000-01-01T00:00:00.000Z", true],
    ["2099-12-31T23:59:59.999Z", true],
    ["2100-01-01T00:00:00.000Z", false],
  ])("checks the bound %s (accepted: %s)", (value, accepted) => {
    expect(parseDueAt(value, "x")).toEqual(
      accepted
        ? { success: true, dueAt: new Date(value) }
        : { success: false, error: DUE_AT_RANGE_ERROR },
    );
  });

  it.each(["0001-03-10T09:30:00.000Z", "+275760-09-13T00:00:00.000Z", "-000001-01-01T00:00:00.000Z"])(
    "gives the range message for the absurd year in %s",
    (value) => {
      expect(parseDueAt(value, "x")).toEqual({ success: false, error: DUE_AT_RANGE_ERROR });
    },
  );

  it("gives the range message for the browser's out-of-range marker", () => {
    expect(parseDueAt("out-of-range", "275760-09-13T00:00")).toEqual({
      success: false,
      error: DUE_AT_RANGE_ERROR,
    });
  });

  it("gives the time-zone message when a date was typed but no UTC value came", () => {
    expect(parseDueAt("", "2026-03-10T09:30")).toEqual({
      success: false,
      error: DUE_AT_TIME_ZONE_ERROR,
    });
  });
});

function reasonErrors(value: unknown): string[] {
  const parsed = skipReasonSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("skipReasonSchema", () => {
  it("trims both ends and keeps inner spaces", () => {
    expect(skipReasonSchema.parse("  Away  this week \n")).toBe("Away  this week");
  });

  it("keeps an inner newline and turns CRLF and a lone CR into LF", () => {
    expect(skipReasonSchema.parse("Away\nall week")).toBe("Away\nall week");
    expect(skipReasonSchema.parse("\r\nAway\r\nall\rweek\r\n")).toBe("Away\nall\nweek");
  });

  it.each(["", "   ", "\n", "\r\n\r\n", " \n \r "])("rejects an empty reason (%j)", (value) => {
    expect(reasonErrors(value)).toEqual([SKIP_REASON_EMPTY_ERROR]);
  });

  it.each([undefined, null, 42])("rejects a non-string (%j) with the empty message", (value) => {
    expect(reasonErrors(value)).toEqual([SKIP_REASON_EMPTY_ERROR]);
  });

  it.each([
    ["a tab", "Away\tall week"],
    ["NUL", "Away\u0000"],
    ["a vertical tab", "Away\u000ball week"],
    ["ESC", "Away\u001b"],
    ["DEL", "Away\u007f"],
    ["U+0085 (NEL)", "Away\u0085now"],
    ["U+009F", "Away\u009f"],
  ])("rejects %s inside the reason", (_label, value) => {
    expect(reasonErrors(value)).toEqual([SKIP_REASON_CONTROL_ERROR]);
  });

  it("accepts 500 code points, including 500 emoji (1000 UTF-16 units)", () => {
    expect(reasonErrors("a".repeat(500))).toEqual([]);
    expect(skipReasonSchema.parse("🧹".repeat(500))).toBe("🧹".repeat(500));
  });

  it("rejects 501 code points, including 501 emoji", () => {
    expect(reasonErrors("a".repeat(501))).toEqual([SKIP_REASON_TOO_LONG_ERROR]);
    expect(reasonErrors("🧹".repeat(501))).toEqual([SKIP_REASON_TOO_LONG_ERROR]);
  });

  it("counts the length after normalising", () => {
    // 498 + CRLF (one LF after normalising) + 1 = 500.
    expect(reasonErrors(`  ${"a".repeat(498)}\r\nb \r\n`)).toEqual([]);
    expect(reasonErrors(`${"a".repeat(498)}\r\nbc`)).toEqual([SKIP_REASON_TOO_LONG_ERROR]);
  });
});
