"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

import { ForbiddenError, requireAdmin, type CurrentHousehold } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  activeInviteWhere,
  generateInviteToken,
  INVITE_TTL_MS,
} from "@/lib/household/invite";
import {
  ADMIN_ONLY_ERROR,
  LAST_ADMIN_ERROR,
  MEMBER_GONE_ERROR,
  REMOVE_SELF_ERROR,
} from "@/app/household/members/messages";

export type MembersActionState = {
  /** A message to show next to the control that was used. */
  error?: string;
};

const MEMBERS_PATH = "/household/members";

/**
 * `requireAdmin()`, but a `member` gets `null` instead of an exception, so the
 * action can answer with form state. Every other error, including the
 * redirects `requireAdmin()` throws for signed-out or household-less callers,
 * is rethrown untouched.
 */
async function adminOrNull(): Promise<CurrentHousehold | null> {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof ForbiddenError) return null;
    throw error;
  }
}

/**
 * Locks the household row so that invite and member changes for one household
 * run one at a time, then re-reads the caller's membership: it may have been
 * removed or demoted since the request started.
 */
async function lockAndReadCaller(
  tx: Prisma.TransactionClient,
  current: CurrentHousehold,
) {
  const householdId = current.household.id;
  await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;
  const caller = await tx.membership.findUnique({
    where: { userId_householdId: { userId: current.membership.userId, householdId } },
  });
  return caller?.role === "admin" ? caller : null;
}

/**
 * Expires the household's active invite (if any) and creates a new one, all
 * under the household lock, so there is never more than one active invite.
 * A replaced invite gets `expiresAt` = now; `consumedAt` stays null because
 * nobody joined with it.
 */
async function issueInvite(): Promise<MembersActionState> {
  const current = await adminOrNull();
  if (!current) return { error: ADMIN_ONLY_ERROR };
  const householdId = current.household.id;

  const outcome = await db.$transaction(async (tx) => {
    const caller = await lockAndReadCaller(tx, current);
    if (!caller) return "forbidden" as const;

    const now = new Date();
    await tx.inviteToken.updateMany({
      where: activeInviteWhere(householdId, now),
      data: { expiresAt: now },
    });
    await tx.inviteToken.create({
      data: {
        householdId,
        createdById: caller.userId,
        token: generateInviteToken(),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      },
    });
    return "issued" as const;
  });

  if (outcome === "forbidden") return { error: ADMIN_ONLY_ERROR };
  revalidatePath(MEMBERS_PATH);
  return {};
}

// Called through useActionState; neither the previous state nor the form is read.
export async function createInvite(): Promise<MembersActionState> {
  return issueInvite();
}

// Called through useActionState; neither the previous state nor the form is read.
export async function regenerateInvite(): Promise<MembersActionState> {
  return issueInvite();
}

export async function removeMember(
  _prev: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  const current = await adminOrNull();
  if (!current) return { error: ADMIN_ONLY_ERROR };
  const householdId = current.household.id;

  const value = formData.get("membershipId");
  const membershipId = typeof value === "string" ? value : "";

  const outcome = await db.$transaction(async (tx) => {
    const caller = await lockAndReadCaller(tx, current);
    if (!caller) return "forbidden" as const;

    const target = membershipId
      ? await tx.membership.findUnique({ where: { id: membershipId } })
      : null;
    if (!target || target.householdId !== householdId) return "gone" as const;
    if (target.id === caller.id) return "self" as const;
    if (target.role === "admin") {
      const admins = await tx.membership.count({ where: { householdId, role: "admin" } });
      if (admins <= 1) return "last-admin" as const;
    }

    // The user is unassigned from this household's chores (any status): a
    // fixed chore left with nobody stays fixed and shows "Unassigned", a claim
    // chore they held becomes unclaimed. Their completion and skip records,
    // the chores they created, and the invites they issued stay as they are.
    await tx.choreAssignee.deleteMany({
      where: { userId: target.userId, chore: { householdId } },
    });
    await tx.membership.delete({ where: { id: target.id } });
    return "removed" as const;
  });

  switch (outcome) {
    case "forbidden":
      return { error: ADMIN_ONLY_ERROR };
    case "gone":
      return { error: MEMBER_GONE_ERROR };
    case "self":
      return { error: REMOVE_SELF_ERROR };
    case "last-admin":
      return { error: LAST_ADMIN_ERROR };
    case "removed":
      revalidatePath(MEMBERS_PATH);
      return {};
  }
}
