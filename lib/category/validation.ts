import * as z from "zod";

import { codePointLength } from "@/lib/household/validation";

// Counted in Unicode code points, not UTF-16 units, so an emoji is one
// character. The form input has no `maxLength` for the same reason: browsers
// count UTF-16 units and would cut an emoji name short.
export const CATEGORY_NAME_MAX_LENGTH = 30;

export const CATEGORY_NAME_EMPTY_ERROR = "Enter a category name.";
export const CATEGORY_NAME_TOO_LONG_ERROR = `Category name must be at most ${CATEGORY_NAME_MAX_LENGTH} characters.`;
export const CATEGORY_NAME_CONTROL_ERROR =
  "Category name can't contain line breaks or control characters.";

// C0 controls (including tab and newline), DEL and C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Trims both ends only; inner spaces are kept as typed. */
export const categoryNameSchema = z
  .string({ error: CATEGORY_NAME_EMPTY_ERROR })
  .overwrite((name) => name.trim())
  .refine((name) => name.length > 0, {
    error: CATEGORY_NAME_EMPTY_ERROR,
    abort: true,
  })
  .refine((name) => !CONTROL_CHARACTERS.test(name), {
    error: CATEGORY_NAME_CONTROL_ERROR,
    abort: true,
  })
  .refine((name) => codePointLength(name) <= CATEGORY_NAME_MAX_LENGTH, {
    error: CATEGORY_NAME_TOO_LONG_ERROR,
  });

/**
 * Whether two trimmed category names count as the same name: a plain
 * `toLowerCase()` comparison, with no locale and no Unicode normalization.
 * So "Straße" and "STRASSE" are different names.
 */
export function sameCategoryName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
