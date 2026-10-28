"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CHORE_CLAIMED_BY_OTHER_ERROR,
  CHORE_CLAIMED_BY_YOU_ERROR,
  CHORE_GONE_ERROR,
  CHORE_NOT_ASSIGNEE_ERROR,
  CHORE_NOT_CLAIM_ERROR,
  CHORE_NOT_CLAIMANT_ERROR,
  CHORE_NOT_PENDING_ERROR,
  CHORE_UNCLAIMED_ERROR,
  choreClaimedMessage,
  choreCompletedMessage,
  choreReleasedMessage,
  choreSkippedMessage,
} from "@/app/chores/messages";
import { requireHousehold } from "@/lib/auth/guards";
import {
  claimChoreInTransaction,
  releaseChoreInTransaction,
  type ClaimChoreOutcome,
  type ReleaseChoreOutcome,
} from "@/lib/chore/claim";
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
  "not-claim": CHORE_NOT_CLAIM_ERROR,
  "claimed-by-you": CHORE_CLAIMED_BY_YOU_ERROR,
  "claimed-by-other": CHORE_CLAIMED_BY_OTHER_ERROR,
  "not-claimant": CHORE_NOT_CLAIMANT_ERROR,
} as const satisfies Record<
  Exclude<
    | CompleteChoreOutcome["kind"]
    | SkipChoreOutcome["kind"]
    | ClaimChoreOutcome["kind"]
    | ReleaseChoreOutcome["kind"],
    "completed" | "skipped" | "claimed" | "released"
  >,
  string
>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * A unique violation for Complete and Skip: `CompletionRecord.choreId` and
 * `SkipRecord.choreId` are unique (one record per chore), so another request
 * got there first.
 */
const RECORD_EXISTS = { kind: "not-pending" } as const;

/**
 * A unique violation for Claim: the only unique its insert can hit is
 * `ChoreAssignee (choreId, userId)`, so the row is the caller's own.
 */
const OWN_CLAIM_EXISTS = { kind: "claimed-by-you" } as const;

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Runs a chore mutation in one transaction, after locking the Household (the
 * lock member removal takes) and re-reading the caller's membership: they may
 * have been removed since the page loaded. A unique violation is answered
 * with `onUniqueViolation`, which each action chooses.
 */
async function inHouseholdTransaction<T extends { kind: string }, U extends { kind: string }>(
  householdId: string,
  userId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  onUniqueViolation: U,
): Promise<T | { kind: "caller-gone" } | U> {
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
    // The locks should make this unreachable; the unique is the backstop.
    if (!isUniqueViolation(error)) throw error;
    return onUniqueViolation;
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
    RECORD_EXISTS,
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
    RECORD_EXISTS,
  );
  afterOutcome(outcome);

  if (outcome.kind === "skipped") {
    return { status: "success", message: choreSkippedMessage(outcome.chore.title) };
  }
  return { status: "error", message: REFUSALS[outcome.kind] };
}

export async function claimChore(
  _prev: ChoreActionState,
  formData: FormData,
): Promise<ChoreActionState> {
  // The same shape as `completeChore`; only `choreId` is read from the form.
  const current = await requireHousehold();
  const householdId = current.household.id;
  const userId = current.membership.userId;
  const choreId = formString(formData, "choreId");

  const outcome = await inHouseholdTransaction(
    householdId,
    userId,
    (tx) => claimChoreInTransaction(tx, { choreId, householdId, userId }),
    OWN_CLAIM_EXISTS,
  );
  afterOutcome(outcome);

  if (outcome.kind === "claimed") {
    return { status: "success", message: choreClaimedMessage(outcome.chore.title) };
  }
  return { status: "error", message: REFUSALS[outcome.kind] };
}

export async function releaseChore(
  _prev: ChoreActionState,
  formData: FormData,
): Promise<ChoreActionState> {
  // The same shape as `claimChore`. Release inserts nothing, so it cannot hit
  // a unique; the not-pending answer is only there to satisfy the helper.
  const current = await requireHousehold();
  const householdId = current.household.id;
  const userId = current.membership.userId;
  const choreId = formString(formData, "choreId");

  const outcome = await inHouseholdTransaction(
    householdId,
    userId,
    (tx) => releaseChoreInTransaction(tx, { choreId, householdId, userId }),
    RECORD_EXISTS,
  );
  afterOutcome(outcome);

  if (outcome.kind === "released") {
    return { status: "success", message: choreReleasedMessage(outcome.chore.title) };
  }
  return { status: "error", message: REFUSALS[outcome.kind] };
}
