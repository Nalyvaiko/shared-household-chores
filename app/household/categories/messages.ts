// Form messages for the categories page actions. Kept out of `actions.ts`
// because a "use server" module may only export async functions.

export const CATEGORY_DUPLICATE_ERROR = "A category with this name already exists.";
export const CATEGORY_GONE_ERROR = "That category no longer exists.";
export const CATEGORY_BUILTIN_ERROR = "Built-in categories can't be deleted.";
