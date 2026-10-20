// Browser-side half of the due-date field contract. `datetime-local` carries
// no time zone and the server can't know the viewer's, so the browser turns
// the typed local time into a UTC instant for the hidden `dueAt` field.

/** Sent in `dueAt` when the browser reports the visible input as bad. */
export const DUE_AT_INVALID_MARKER = "invalid";

// `datetime-local` allows years up to 275760, but `Date` only parses
// four-digit years from a string, so longer ones are read field by field.
const LONG_YEAR_LOCAL = /^(\d{5,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function parseLongYearLocal(local: string): Date {
  const match = LONG_YEAR_LOCAL.exec(local);
  if (!match) return new Date(NaN);
  const [, year, month, day, hours, minutes, seconds = "0", millis = "0"] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
    Number(millis.padEnd(3, "0")),
  );
}

/**
 * Converts a `datetime-local` value (`YYYY-MM-DDTHH:mm`) to the
 * `toISOString()` of that time in the browser's zone. `new Date()` parses a
 * date-time with no offset as local time. An empty, valid input gives "";
 * one the browser reports as incomplete (`validity.badInput`) gives the
 * invalid marker, as does anything `Date` can't read. An out-of-range year
 * still converts, so the server can answer with the range message.
 */
export function localToUtcIso(local: string, badInput = false): string {
  if (badInput) return DUE_AT_INVALID_MARKER;
  if (local === "") return "";
  let instant = new Date(local);
  if (Number.isNaN(instant.getTime())) instant = parseLongYearLocal(local);
  if (Number.isNaN(instant.getTime())) return DUE_AT_INVALID_MARKER;
  return instant.toISOString();
}
