import * as z from "zod";

import { codePointLength } from "@/lib/household/validation";

// Counted in Unicode code points, not UTF-16 units, so an emoji is one
// character. The form input has no `maxLength` for the same reason: browsers
// count UTF-16 units and would cut an emoji title short.
export const CHORE_TITLE_MAX_LENGTH = 120;

export const CHORE_TITLE_EMPTY_ERROR = "Enter a chore title.";
export const CHORE_TITLE_TOO_LONG_ERROR = `Chore title must be at most ${CHORE_TITLE_MAX_LENGTH} characters.`;
export const CHORE_TITLE_CONTROL_ERROR =
  "Chore title can't contain line breaks or control characters.";

export const CHORE_PRIORITY_ERROR = "Choose a priority.";
export const CHORE_EFFORT_ERROR = "Choose an effort level.";

export const DUE_AT_INVALID_ERROR = "Enter a valid due date and time, or clear it.";
export const DUE_AT_RANGE_ERROR = "Due date must be between the years 2000 and 2099.";
export const DUE_AT_TIME_ZONE_ERROR =
  "Couldn't read your time zone. Reload the page and try again.";

// C0 controls (including tab and newline), DEL and C1 controls: the same set
// household and category names reject.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Trims both ends only; inner spaces are kept as typed. */
export const choreTitleSchema = z
  .string({ error: CHORE_TITLE_EMPTY_ERROR })
  .overwrite((title) => title.trim())
  .refine((title) => title.length > 0, {
    error: CHORE_TITLE_EMPTY_ERROR,
    abort: true,
  })
  .refine((title) => !CONTROL_CHARACTERS.test(title), {
    error: CHORE_TITLE_CONTROL_ERROR,
    abort: true,
  })
  .refine((title) => codePointLength(title) <= CHORE_TITLE_MAX_LENGTH, {
    error: CHORE_TITLE_TOO_LONG_ERROR,
  });

// Listed in display order; the values match the Prisma enums.
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const EFFORTS = ["small", "medium", "large"] as const;

/** Missing, empty or unknown values are refused, never replaced with a default. */
export const prioritySchema = z.enum(PRIORITIES, { error: CHORE_PRIORITY_ERROR });
export const effortSchema = z.enum(EFFORTS, { error: CHORE_EFFORT_ERROR });

// Saved due dates must fall in [2000-01-01T00:00:00Z, 2100-01-01T00:00:00Z).
const DUE_AT_MIN = Date.UTC(2000, 0, 1);
const DUE_AT_MAX = Date.UTC(2100, 0, 1);

// A strict UTC ISO datetime ending in "Z", as `Date#toISOString()` writes it.
const utcInstantSchema = z.iso.datetime();
// `toISOString()` writes years past 9999 as "+275760-…". Such a value is a
// well-formed instant, just out of range, so it gets the range message.
const EXPANDED_YEAR_ISO = /^[+-]\d{6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type DueAtResult =
  | { success: true; dueAt: Date | null }
  | { success: false; error: string };

/**
 * Reads the due date from the form's two fields. `dueAt` is the UTC instant
 * the browser computed (or "invalid"); `dueAtLocal` is the visible input,
 * used only to tell whether a date was typed. The server never guesses a zone.
 */
export function parseDueAt(dueAt: string, dueAtLocal: string): DueAtResult {
  if (dueAt === "") {
    if (dueAtLocal === "") return { success: true, dueAt: null };
    // A date was typed but the browser sent no UTC value (no JavaScript yet).
    return { success: false, error: DUE_AT_TIME_ZONE_ERROR };
  }

  const wellFormed = utcInstantSchema.safeParse(dueAt).success || EXPANDED_YEAR_ISO.test(dueAt);
  const instant = new Date(dueAt);
  if (!wellFormed || Number.isNaN(instant.getTime())) {
    return { success: false, error: DUE_AT_INVALID_ERROR };
  }

  const time = instant.getTime();
  if (time < DUE_AT_MIN || time >= DUE_AT_MAX) {
    return { success: false, error: DUE_AT_RANGE_ERROR };
  }
  return { success: true, dueAt: instant };
}
