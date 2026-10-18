"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { InviteProblem } from "@/app/invite/[token]/messages";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { isWellFormedInviteToken } from "@/lib/household/invite";

export type JoinHouseholdState = {
  /** Why the join did not happen, when it did not. */
  problem?: InviteProblem;
};

export async function joinHousehold(
  _prev: JoinHouseholdState,
  formData: FormData,
): Promise<JoinHouseholdState> {
  // The token comes from the client, so its format is checked again before
  // anything touches the database.
  const token = formData.get("token");
  if (!isWellFormedInviteToken(token)) return { problem: "unknown" };

  // The user always comes from the session, never from the form. Redirects
  // throw, so this and every redirect below stay outside try and the
  // transaction callback.
  const user = await requireUser({ callbackUrl: `/invite/${token}` });

  // The page may be stale, so everything it showed is checked again here.
  // Locks are taken User -> Household -> InviteToken. Regenerating a link
  // (task #10) takes Household -> InviteToken, so the two cannot deadlock.
  const outcome = await db.$transaction(async (tx) => {
    const invite = await tx.inviteToken.findUnique({
      where: { token },
      select: { householdId: true },
    });
    if (!invite) return "unknown" as const;

    // Serialises this user's joins and household creation (task #9): a second
    // request waits here, then sees the membership the first one created.
    const lockedUser = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    if (lockedUser.length === 0) return "user-deleted" as const;

    // Serialises with the members actions (task #10) for this household.
    const lockedHousehold = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Household" WHERE id = ${invite.householdId} FOR UPDATE`;
    if (lockedHousehold.length === 0) return "unknown" as const;

    // Read the clock only now that the locks are held. A regenerate that ran
    // while this transaction waited has set the old link's `expiresAt` to its
    // own JS `new Date()`, so a time taken before the wait would still see that
    // link as active. This is the app clock, like regenerate's, not Postgres
    // `now()` (which is fixed at transaction start).
    const now = new Date();

    const existing = await tx.membership.findFirst({
      where: { userId: user.id },
      select: { householdId: true },
    });
    if (existing) {
      return existing.householdId === invite.householdId
        ? ("member-here" as const)
        : ("other-household" as const);
    }

    // Only an unused, unexpired token is consumed; of two concurrent joins,
    // only one can update the row.
    const consumed = await tx.inviteToken.updateMany({
      where: { token, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) {
      const current = await tx.inviteToken.findUnique({
        where: { token },
        select: { consumedAt: true },
      });
      if (!current) return "unknown" as const;
      return current.consumedAt ? ("used" as const) : ("expired" as const);
    }

    await tx.membership.create({
      data: { userId: user.id, householdId: invite.householdId, role: "member" },
    });
    return "joined" as const;
  });

  switch (outcome) {
    case "user-deleted":
      redirect("/signin");
    case "joined":
    case "member-here":
      // The root layout's header shows a Members item only to users with a
      // household; refresh it so it appears without a full reload.
      revalidatePath("/", "layout");
      // Joined now, or already joined by an earlier submit or another tab.
      redirect("/");
    default:
      return { problem: outcome };
  }
}
