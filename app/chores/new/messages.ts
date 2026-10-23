// Form messages for the new-chore action. Kept out of `actions.ts` because a
// "use server" module may only export async functions. The title, priority,
// effort and due-date messages live with their rules in `lib/chore/validation.ts`.

/** The same answer for an unknown id and another household's category. */
export const CHORE_CATEGORY_GONE_ERROR = "That category no longer exists. Choose another one.";

/**
 * The same answer for an unknown id, an empty value, another household's user
 * and a removed member, so the response doesn't reveal whether the user exists.
 */
export const CHORE_ASSIGNEE_GONE_ERROR =
  "Someone you picked is no longer in this household. Check the list and try again.";
