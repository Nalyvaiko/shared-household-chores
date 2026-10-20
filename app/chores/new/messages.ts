// Form messages for the new-chore action. Kept out of `actions.ts` because a
// "use server" module may only export async functions. The title, priority,
// effort and due-date messages live with their rules in `lib/chore/validation.ts`.

/** The same answer for an unknown id and another household's category. */
export const CHORE_CATEGORY_GONE_ERROR = "That category no longer exists. Choose another one.";
