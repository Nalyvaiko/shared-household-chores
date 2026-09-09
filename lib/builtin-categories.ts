/**
 * The canonical set of built-in category names.
 *
 * Every household starts with exactly these categories (each stored as a
 * `Category` row with `builtIn = true`). This array is the single source of
 * truth: the database seed (task #5) and household creation (task #9) both
 * import it — the names are never copied anywhere else.
 *
 * `name` is half of a built-in category's natural key (`householdId` + `name`),
 * so renaming an entry after households exist is a data migration, not just an
 * edit here. Adding or removing an entry only affects households created later.
 */
export const BUILTIN_CATEGORY_NAMES = [
  "Kitchen",
  "Bathroom",
  "Cleaning",
  "Laundry",
  "Outdoor",
  "Pets",
  "Admin",
] as const;

export type BuiltinCategoryName = (typeof BUILTIN_CATEGORY_NAMES)[number];
