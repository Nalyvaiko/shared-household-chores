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
  choreSkippedMessage,
} from "@/app/chores/messages";
import { requireHousehold } from "@/lib/auth/guards";
import { completeChoreInTransaction, type CompleteChoreOutcome } from "@/lib/chore/complete";
import { skipChoreInTransaction, type SkipChoreOutcome } from "@/lib/chore/skip";
import { skipReasonSchema } from "@/lib/chore/validation";
import { db } from "@/lib/db";

/** The outcome of a chore row action, shown in the page's message region. */
export type ChoreActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | {
      status: "error";
      message: string;
      /**
       * Set only when a skip reason was refused: the row and the text exactly
       * as submitted, so that row's Skip form can reopen with it.
       */
      skipDraft?: { choreId: string; reason: string };
    };

const REFUSALS = {
  gone: CHORE_GONE_ERROR,
  "not-pending": CHORE_NOT_PENDING_ERROR,
  unclaimed: CHORE_UNCLAIMED_ERROR,
  "not-assignee": CHORE_NOT_ASSIGNEE_ERROR,
} as const satisfies Record<
  Exclude<CompleteChoreOutcome["kind"] | SkipChoreOutcome["kind"], "completed" | "skipped">,
  string
>;

function isUniqueViolation(error: unknown): boolean {
  // `CompletionRecord.choreId` and `SkipRecord.choreId` are unique: one record per chore.
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Runs a chore mutation in one transaction, after locking the Household (the
 * lock member removal takes) and re-reading the caller's membership: they may
 * have been removed since the page loaded. A unique violation on a chore's
 * record means another request got there first.
 */
async function inHouseholdTransaction<T extends { kind: string }>(
  householdId: string,
  userId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | { kind: "caller-gone" } | { kind: "not-pending" }> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;
      const caller = await tx.membership.findUnique({
        where: { userId_householdId: { userId, householdId } },
      });
      if (!caller) return { kind: "caller-gone" } as const;

      return work(tx);
    });
  } catch (error) {
    // The chore lock should make this unreachable; the unique record is the backstop.
    if (!isUniqueViolation(error)) throw error;
    return { kind: "not-pending" };
  }
}

/** Redirects a removed caller; otherwise refreshes both lists. */
function afterOutcome<T extends { kind: string }>(
  outcome: T,
): asserts outcome is Exclude<T, { kind: "caller-gone" }> {
  if (outcome.kind === "caller-gone") {
    // The header's household items go too.
    revalidatePath("/", "layout");
    redirect("/household/new");
  }
  // Every other outcome refreshes both lists, so a stale row goes with the message.
  revalidatePath("/");
  revalidatePath("/chores");
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
  const choreId = formString(formData, "choreId");

  const outcome = await inHouseholdTransaction(householdId, userId, (tx) =>
    completeChoreInTransaction(tx, { choreId, householdId, userId, now }),
  );
  afterOutcome(outcome);

  if (outcome.kind === "completed") {
    return { status: "success", message: choreCompletedMessage(outcome.chore.title) };
  }
  return { status: "error", message: REFUSALS[outcome.kind] };
}

export async function skipChore(
  _prev: ChoreActionState,
  formData: FormData,
): Promise<ChoreActionState> {
  // The same shape as `completeChore`; only `choreId` and `reason` are read
  // from the form.
  const now = new Date();
  const current = await requireHousehold();
  const householdId = current.household.id;
  const userId = current.membership.userId;
  const choreId = formString(formData, "choreId");
  const submitted = formString(formData, "reason");

  // Checked before the transaction: a refused reason writes nothing.
  const parsed = skipReasonSchema.safeParse(submitted);
  if (!parsed.success) {
    revalidatePath("/");
    revalidatePath("/chores");
    return {
      status: "error",
      message: parsed.error.issues[0].message,
      skipDraft: { choreId, reason: submitted },
    };
  }
  const reason = parsed.data;

  const outcome = await inHouseholdTransaction(householdId, userId, (tx) =>
    skipChoreInTransaction(tx, { choreId, householdId, userId, reason, now }),
  );
  afterOutcome(outcome);

  if (outcome.kind === "skipped") {
    return { status: "success", message: choreSkippedMessage(outcome.chore.title) };
  }
  return { status: "error", message: REFUSALS[outcome.kind] };
}
