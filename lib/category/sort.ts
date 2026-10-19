type SortableCategory = { id: string; name: string; builtIn: boolean };

function compareCategories(a: SortableCategory, b: SortableCategory): number {
  if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
  const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Display order for a household's categories: built-ins first, then custom
 * ones, each group by name ignoring case and accents, ties broken by id.
 * Sorted in code rather than in SQL so the order does not depend on the
 * database collation. Returns a new array.
 */
export function sortCategories<T extends SortableCategory>(categories: readonly T[]): T[] {
  return [...categories].sort(compareCategories);
}
