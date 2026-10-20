// Browser-side half of the due-date field contract. `datetime-local` carries
// no time zone and the server can't know the viewer's, so the browser turns
// the typed local time into a UTC instant for the hidden `dueAt` field.

/** Sent in `dueAt` when the browser reports the visible input as bad. */
export const DUE_AT_INVALID_MARKER = "invalid";

/**
 * Converts a `datetime-local` value (`YYYY-MM-DDTHH:mm`) to the
 * `toISOString()` of that time in the browser's zone. `new Date()` parses a
 * date-time with no offset as local time. An empty, valid input gives "";
 * one the browser reports as incomplete (`validity.badInput`) gives the
 * invalid marker, as does anything `Date` can't read.
 */
export function localToUtcIso(local: string, badInput = false): string {
  if (badInput) return DUE_AT_INVALID_MARKER;
  if (local === "") return "";
  const instant = new Date(local);
  if (Number.isNaN(instant.getTime())) return DUE_AT_INVALID_MARKER;
  return instant.toISOString();
}
