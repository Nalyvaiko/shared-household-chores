// Form messages for the members page actions. Kept out of `actions.ts`
// because a "use server" module may only export async functions.

export const ADMIN_ONLY_ERROR = "Only a household admin can do this.";
export const MEMBER_GONE_ERROR = "That person is no longer in this household.";
export const REMOVE_SELF_ERROR = "You can't remove yourself.";
export const LAST_ADMIN_ERROR = "A household needs at least one admin.";
