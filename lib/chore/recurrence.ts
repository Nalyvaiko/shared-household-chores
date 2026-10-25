import type { RecurrenceFrequency } from "@prisma/client";

// The next due date of a recurring chore. All math is in UTC, so DST never
// shifts it; a time entered in local time can show an hour off after a DST
// change, which is accepted.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The number of days in a UTC month (`month` is 0-based and may overflow). */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * One step after `previousDueAt` (or after `now` when the chore had no due
 * date): daily +1 day, weekly +7 days, monthly +1 calendar month clamped to
 * the last day of the target month (Jan 31 → Feb 28, then Feb 28 → Mar 28).
 * The time of day is kept. Exactly one step is taken, so the result may
 * still be in the past; it is not checked against the form's date range.
 */
export function nextDueAt(
  recurrence: Exclude<RecurrenceFrequency, "none">,
  previousDueAt: Date | null,
  now: Date,
): Date {
  const base = previousDueAt ?? now;
  switch (recurrence) {
    case "daily":
      return new Date(base.getTime() + DAY_MS);
    case "weekly":
      return new Date(base.getTime() + 7 * DAY_MS);
    case "monthly": {
      const year = base.getUTCFullYear();
      const month = base.getUTCMonth() + 1;
      const day = Math.min(base.getUTCDate(), daysInMonth(year, month));
      return new Date(
        Date.UTC(
          year,
          month,
          day,
          base.getUTCHours(),
          base.getUTCMinutes(),
          base.getUTCSeconds(),
          base.getUTCMilliseconds(),
        ),
      );
    }
  }
}
