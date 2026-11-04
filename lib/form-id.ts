// Reading a record id posted by a form. Ids are only ever looked up, so
// anything that cannot be a real id is turned away before it reaches a query:
// Postgres rejects a NUL byte in text with an error (22021), which would
// otherwise surface as a 500 instead of the usual "no longer exists" answer.

/** Longer than any id the app generates, with room to spare. */
export const MAX_ID_LENGTH = 200;

// C0 controls (NUL included), DEL and C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Whether `value` could be an id: a string that is not empty after trimming,
 * at most `MAX_ID_LENGTH` characters, with no control characters. Whether the
 * record exists is still for the database to answer.
 */
export function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_ID_LENGTH &&
    !CONTROL_CHARACTERS.test(value)
  );
}

/**
 * The id posted as `name`, or `null` when it is missing, a file, empty, too
 * long or contains a control character. Callers answer `null` exactly as they
 * answer an unknown id, without querying.
 */
export function formId(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return isPlausibleId(value) ? value : null;
}
