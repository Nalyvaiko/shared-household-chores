// Browser-side half of the due-date field contract. `datetime-local` carries
// no time zone and the server can't know the viewer's, so the browser turns
// the typed local time into a UTC instant for the hidden `dueAt` field.

/** Sent in `dueAt` when the browser reports the visible input as bad. */
export const DUE_AT_INVALID_MARKER = "invalid";
/** Sent in `dueAt` for a local year no time zone can bring into 2000–2099. */
export const DUE_AT_OUT_OF_RANGE_MARKER = "out-of-range";

// The input's own limits, as hints for the picker. The server checks the
// real range on the UTC instant.
export const DUE_AT_LOCAL_MIN = "2000-01-01T00:00";
export const DUE_AT_LOCAL_MAX = "2099-12-31T23:59";

// Zone offsets are under a day, so a local time in 1999 or 2100 may still be
// an instant inside 2000–2099, but a local year outside 1999–2100 never is.
// Such years are refused from the year alone: `datetime-local` allows years
// up to 275760, which `new Date()` either can't parse or, near that maximum
// and west of UTC, can't represent.
const LOCAL_YEAR = /^(\d{4,6})-/;
const FIRST_POSSIBLE_YEAR = 1999;
const LAST_POSSIBLE_YEAR = 2100;

/**
 * Converts a `datetime-local` value (`YYYY-MM-DDTHH:mm`) to the
 * `toISOString()` of that time in the browser's zone. `new Date()` parses a
 * date-time with no offset as local time. An empty, valid input gives "";
 * one the browser reports as incomplete (`validity.badInput`) gives the
 * invalid marker, as does anything `Date` can't read. A year that can't be
 * in range in any zone gives the out-of-range marker.
 */
export function localToUtcIso(local: string, badInput = false): string {
  if (badInput) return DUE_AT_INVALID_MARKER;
  if (local === "") return "";

  const year = LOCAL_YEAR.exec(local);
  if (year) {
    const value = Number(year[1]);
    if (value < FIRST_POSSIBLE_YEAR || value > LAST_POSSIBLE_YEAR) {
      return DUE_AT_OUT_OF_RANGE_MARKER;
    }
  }

  const instant = new Date(local);
  if (Number.isNaN(instant.getTime())) return DUE_AT_INVALID_MARKER;
  return instant.toISOString();
}

/**
 * Sent in `dueAt` by the edit form until the browser has filled the field:
 * the server render can't know the viewer's zone. With an empty visible
 * field it keeps the stored due date.
 */
export const DUE_AT_UNCHANGED_MARKER = "unchanged";

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/**
 * The `datetime-local` value (`YYYY-MM-DDTHH:mm`) of a UTC ISO instant in the
 * browser's zone: the inverse of `localToUtcIso`, to the minute.
 */
export function utcIsoToLocal(iso: string): string {
  const date = new Date(iso);
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
