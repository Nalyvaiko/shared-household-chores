"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CHORE_GONE_ERROR,
  CHORE_NOT_ASSIGNEE_ERROR,
  CHORE_NOT_PENDING_ERROR,
  CHORE_UNCLAIMED_ERROR,
  choreCompletedMessage,
} from "@/app/chores/messages";
import { requireHousehold } from "@/lib/auth/guards";
import { completeChoreInTransaction, type CompleteChoreOutcome } from "@/lib/chore/complete";
import { db } from "@/lib/db";

/** The outcome of a chore row action, shown in the page's message region. */
export type ChoreActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const REFUSALS = {
  gone: CHORE_GONE_ERROR,
  "not-pending": CHORE_NOT_PENDING_ERROR,
  unclaimed: CHORE_UNCLAIMED_ERROR,
  "not-assignee": CHORE_NOT_ASSIGNEE_ERROR,
} as const satisfies Record<Exclude<CompleteChoreOutcome["kind"], "completed">, string>;

function isUniqueViolation(error: unknown): boolean {
  // `CompletionRecord.choreId` is unique: one record per chore.
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function completeChore(
  _prev: ChoreActionState,
  formData: FormData,
): Promise<ChoreActionState> {
  // One server "now" for the whole request; nothing but `choreId` is read
  // from the form. The household and user come from the session. Redirects
  // throw, so they stay outside try and the transaction callback.
  const now = new Date();
  const current = await requireHousehold();
  const householdId = current.household.id;
  const userId = current.membership.userId;

  const value = formData.get("choreId");
  const choreId = typeof value === "string" ? value : "";

  let outcome: CompleteChoreOutcome | { kind: "caller-gone" };
  try {
    outcome = await db.$transaction(async (tx) => {
      // Household first (the lock member removal takes), then the caller's
      // membership, re-read: they may have been removed since the page loaded.
      await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;
      const caller = await tx.membership.findUnique({
        where: { userId_householdId: { userId, householdId } },
      });
      if (!caller) return { kind: "caller-gone" } as const;

      return completeChoreInTransaction(tx, { choreId, householdId, userId, now });
    });
  } catch (error) {
    // The chore lock should make this unreachable; the unique record is the backstop.
    if (!isUniqueViolation(error)) throw error;
    outcome = { kind: "not-pending" };
  }

  if (outcome.kind === "caller-gone") {
    // The header's household items go too.
    revalidatePath("/", "layout");
    redirect("/household/new");
  }

  // Every other outcome refreshes both lists, so a stale row goes with the message.
  revalidatePath("/");
  revalidatePath("/chores");

  if (outcome.kind === "completed") {
    return { status: "success", message: choreCompletedMessage(outcome.chore.title) };
  }
  return { status: "error", message: REFUSALS[outcome.kind] };
}
