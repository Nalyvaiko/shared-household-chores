import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Household, Membership } from "@prisma/client";

import { auth } from "@/auth";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { db } from "@/lib/db";

// Every page and Server Action resolves the caller through these helpers. The
// user always comes from the session and the household from that user's
// membership, so no helper accepts an id that a client could choose.
//
// `redirect()` works by throwing; never wrap these calls in try/catch.

/** The signed-in user, as stored in the database. Never includes `passwordHash`. */
export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
};

/** The current user's household and their membership in it. */
export type CurrentHousehold = {
  household: Household;
  membership: Membership;
};

/** Thrown by `requireAdmin()` when the current user is a `member`. */
export class ForbiddenError extends Error {
  constructor(message = "Only a household admin can do this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Returns the signed-in user, or `null` when there is no session or the
 * session's user no longer exists. Cached for the duration of a request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
});

/**
 * Returns the signed-in user, or redirects to `/signin` (carrying a safe
 * `callbackUrl`, when given) if there is none.
 */
export async function requireUser(
  options: { callbackUrl?: string } = {},
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(withCallbackUrl("/signin", options.callbackUrl));
  return user;
}

/**
 * Returns the current user's household and membership, or `null` when there
 * is no current user or the user has no membership. Cached per request.
 */
export const getCurrentHousehold = cache(
  async (): Promise<CurrentHousehold | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    const membership = await db.membership.findFirst({
      where: { userId: user.id },
      include: { household: true },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) return null;

    const { household, ...rest } = membership;
    return { household, membership: rest };
  },
);

/**
 * Returns the current household, redirecting to `/signin` when signed out and
 * to `/household/new` when the user has no household yet.
 */
export async function requireHousehold(): Promise<CurrentHousehold> {
  await requireUser();
  const current = await getCurrentHousehold();
  if (!current) redirect("/household/new");
  return current;
}

/**
 * Like `requireHousehold()`, but throws `ForbiddenError` unless the user is
 * the household's admin.
 */
export async function requireAdmin(): Promise<CurrentHousehold> {
  const current = await requireHousehold();
  if (current.membership.role !== "admin") throw new ForbiddenError();
  return current;
}
