import * as z from "zod";

// Counted in Unicode code points, not UTF-16 units, so an emoji is one
// character. The form input has no `maxLength` for the same reason: browsers
// count UTF-16 units and would cut an emoji name at 30.
export const HOUSEHOLD_NAME_MAX_LENGTH = 60;

export const HOUSEHOLD_NAME_EMPTY_ERROR = "Enter a household name.";
export const HOUSEHOLD_NAME_TOO_LONG_ERROR = `Household name must be at most ${HOUSEHOLD_NAME_MAX_LENGTH} characters.`;
export const HOUSEHOLD_NAME_CONTROL_ERROR =
  "Household name can't contain line breaks or control characters.";

// C0 controls (including tab and newline), DEL and C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function codePointLength(value: string): number {
  return [...value].length;
}

export const householdNameSchema = z
  .string({ error: HOUSEHOLD_NAME_EMPTY_ERROR })
  .overwrite((name) => name.trim())
  .refine((name) => name.length > 0, {
    error: HOUSEHOLD_NAME_EMPTY_ERROR,
    abort: true,
  })
  .refine((name) => !CONTROL_CHARACTERS.test(name), {
    error: HOUSEHOLD_NAME_CONTROL_ERROR,
    abort: true,
  })
  .refine((name) => codePointLength(name) <= HOUSEHOLD_NAME_MAX_LENGTH, {
    error: HOUSEHOLD_NAME_TOO_LONG_ERROR,
  });
