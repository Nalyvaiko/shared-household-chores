"use server";

import type { AssignmentMode, Chore, Membership, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CHORE_GONE_ERROR, CHORE_NOT_PENDING_ERROR } from "@/app/chores/messages";
import {
  CHORE_ASSIGNEE_GONE_ERROR,
  CHORE_CATEGORY_GONE_ERROR,
} from "@/app/chores/new/messages";
import { ADMIN_ONLY_ERROR } from "@/app/household/members/messages";
import { ForbiddenError, requireAdmin, requireHousehold } from "@/lib/auth/guards";
import { assigneeChanges, canChangeAssignment } from "@/lib/chore/edit";
import {
  assigneeIdsField,
  field,
  type ChoreFormErrors,
  type ChoreFormState,
  type ChoreFormValues,
} from "@/lib/chore/form";
import { categoryBelongs, nonMemberIds } from "@/lib/chore/references";
import { inHouseholdTransaction } from "@/lib/chore/transaction";
import {
  assignmentModeSchema,
  choreTitleSchema,
  effortSchema,
  parseEditedDueAt,
  prioritySchema,
  recurrenceSchema,
  resolveEditedDueAt,
} from "@/lib/chore/validation";
import { db } from "@/lib/db";

export type DeleteChoreState = {
  /** A refusal, shown next to the delete control. */
  error?: string;
};

const CHORES_PATH = "/chores";

function editPath(choreId: string): string {
  return `/chores/${encodeURIComponent(choreId)}/edit`;
}

/** The form fields, parsed with the create schemas. Nothing here reads the database. */
function parseFields(formData: FormData) {
  const assignmentModeValue = field(formData, "assignmentMode");
  const values: ChoreFormValues = {
    title: field(formData, "title"),
    dueAtLocal: field(formData, "dueAtLocal"),
    priority: field(formData, "priority"),
    effort: field(formData, "effort"),
    categoryId: field(formData, "categoryId"),
    recurrence: field(formData, "recurrence"),
    assignmentMode: assignmentModeValue,
    // In Claim mode the ids are neither validated, saved nor echoed.
    assigneeIds: assignmentModeValue === "claim" ? [] : assigneeIdsField(formData),
  };
  return {
    values,
    title: choreTitleSchema.safeParse(values.title),
    dueAt: parseEditedDueAt(field(formData, "dueAt"), values.dueAtLocal),
    priority: prioritySchema.safeParse(values.priority),
    effort: effortSchema.safeParse(values.effort),
    recurrence: recurrenceSchema.safeParse(values.recurrence),
    assignmentMode: assignmentModeSchema.safeParse(values.assignmentMode),
  };
}

type ParsedFields = ReturnType<typeof parseFields>;

/** Whether a field that doesn't depend on the stored chore was refused. */
function hasFieldError(parsed: ParsedFields): boolean {
  return (
    !parsed.title.success ||
    parsed.dueAt.kind === "error" ||
    !parsed.priority.success ||
    !parsed.effort.success ||
    !parsed.recurrence.success
  );
}

type StoredChore = Pick<Chore, "createdById" | "dueAt" | "assignmentMode">;

/**
 * Every check against the stored chore and the household: the due date
 * against the stored one, the mode (only for someone who may change it), the
 * category and the picked members. A caller who may not change the
 * assignment has their posted mode and ids ignored.
 */
async function check(
  client: Pick<Prisma.TransactionClient, "category" | "membership">,
  parsed: ParsedFields,
  chore: StoredChore,
  caller: Pick<Membership, "userId" | "role">,
  householdId: string,
) {
  const mayAssign = canChangeAssignment(chore, caller);
  const errors: ChoreFormErrors = {};
  if (!parsed.title.success) errors.title = parsed.title.error.issues.map((i) => i.message);
  const dueAt = resolveEditedDueAt(parsed.dueAt, chore.dueAt);
  if (!dueAt.success) errors.dueAt = [dueAt.error];
  if (!parsed.priority.success) {
    errors.priority = parsed.priority.error.issues.map((i) => i.message);
  }
  if (!parsed.effort.success) errors.effort = parsed.effort.error.issues.map((i) => i.message);
  if (!parsed.recurrence.success) {
    errors.recurrence = parsed.recurrence.error.issues.map((i) => i.message);
  }
  if (mayAssign && !parsed.assignmentMode.success) {
    errors.assignmentMode = parsed.assignmentMode.error.issues.map((i) => i.message);
  }

  // Only a valid Fixed mode from someone who may assign reads the ticks.
  const mode: AssignmentMode =
    mayAssign && parsed.assignmentMode.success ? parsed.assignmentMode.data : chore.assignmentMode;
  const tickedIds =
    mayAssign && parsed.assignmentMode.success && mode === "fixed" ? parsed.values.assigneeIds : [];
  const categoryId = parsed.values.categoryId;
  const categoryGone =
    categoryId !== "" && !(await categoryBelongs(client, categoryId, householdId));
  const goneIds = await nonMemberIds(client, tickedIds, householdId);

  const refused = Object.keys(errors).length > 0 || categoryGone || goneIds.length > 0;
  return { refused, mayAssign, errors, dueAt, mode, tickedIds, categoryGone, goneIds };
}

type Checked = Awaited<ReturnType<typeof check>>;

/**
 * Builds a refusal, like the create action's: a gone category falls back to
 * None and a gone member's tick is dropped, each with its message, and the
 * page is revalidated so the select and the list show the current rows.
 */
function refuse(
  choreId: string,
  values: ChoreFormValues,
  chore: StoredChore,
  { errors, mayAssign, categoryGone, goneIds }: Checked,
): ChoreFormState {
  // The mode and ticks of someone who may not change them aren't echoed.
  const echoed: ChoreFormValues = mayAssign
    ? { ...values }
    : { ...values, assignmentMode: chore.assignmentMode, assigneeIds: [] };
  const allErrors = { ...errors };
  if (categoryGone || goneIds.length > 0) revalidatePath(editPath(choreId));
  if (categoryGone) {
    echoed.categoryId = "";
    allErrors.categoryId = [CHORE_CATEGORY_GONE_ERROR];
  }
  if (goneIds.length > 0) {
    echoed.assigneeIds = echoed.assigneeIds.filter((id) => !goneIds.includes(id));
    allErrors.assigneeIds = [CHORE_ASSIGNEE_GONE_ERROR];
  }
  return { values: echoed, errors: allErrors };
}

/**
 * Locks the chore row, filtered by household so another household's chore is
 * never locked. The caller has already taken the Household lock, so the order
 * is Household → Chore, as in `lib/chore/complete.ts`.
 */
async function lockChore(
  tx: Prisma.TransactionClient,
  choreId: string,
  householdId: string,
): Promise<boolean> {
  if (!choreId) return false;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Chore" WHERE id = ${choreId} AND "householdId" = ${householdId} FOR UPDATE`;
  return locked.length > 0;
}

export async function updateChore(
  _prev: ChoreFormState,
  formData: FormData,
): Promise<ChoreFormState> {
  // The household and caller come from the session, the chore from the
  // hidden `choreId`. Only the listed fields are read: status, householdId,
  // createdById and anything else posted are ignored. Redirects throw, so
  // they stay outside the transaction callback.
  const current = await requireHousehold();
  const householdId = current.household.id;
  const userId = current.membership.userId;
  const choreId = field(formData, "choreId");
  const parsed = parseFields(formData);
  const { values } = parsed;

  if (hasFieldError(parsed)) {
    // Nothing will be written, so these reads take no lock. They still run,
    // so every invalid field is reported at once.
    const stored = choreId
      ? await db.chore.findFirst({
          where: { id: choreId, householdId },
          select: { createdById: true, dueAt: true, assignmentMode: true, status: true },
        })
      : null;
    if (!stored) return { values, formError: CHORE_GONE_ERROR };
    if (stored.status !== "pending") return { values, formError: CHORE_NOT_PENDING_ERROR };
    const checked = await check(db, parsed, stored, current.membership, householdId);
    return refuse(choreId, values, stored, checked);
  }

  const outcome = await inHouseholdTransaction(householdId, userId, async (tx, caller) => {
    if (!(await lockChore(tx, choreId, householdId))) return { kind: "gone" } as const;
    const chore = await tx.chore.findUnique({
      where: { id: choreId },
      include: { assignees: { select: { userId: true } } },
    });
    if (!chore || chore.householdId !== householdId) return { kind: "gone" } as const;
    if (chore.status !== "pending") return { kind: "not-pending" } as const;

    // The role re-read under the lock and the creator from the locked row.
    const checked = await check(tx, parsed, chore, caller, householdId);
    if (checked.refused || !checked.dueAt.success) {
      return { kind: "refused", chore, checked } as const;
    }

    // `update` (not `updateMany`) so `updatedAt` moves. status, createdById
    // and householdId are never written. A changed recurrence only changes
    // the field; the next completion uses it.
    await tx.chore.update({
      where: { id: chore.id },
      data: {
        title: parsed.title.data!,
        dueAt: checked.dueAt.dueAt,
        priority: parsed.priority.data!,
        effort: parsed.effort.data!,
        categoryId: values.categoryId || null,
        recurrence: parsed.recurrence.data!,
        ...(checked.mayAssign && { assignmentMode: checked.mode }),
      },
    });

    if (checked.mayAssign) {
      const existingIds = chore.assignees.map((a) => a.userId);
      const formerIds =
        chore.assignmentMode === "fixed" && checked.mode === "fixed"
          ? await nonMemberIds(tx, existingIds, householdId)
          : [];
      const changes = assigneeChanges({
        from: chore.assignmentMode,
        to: checked.mode,
        existingIds,
        formerIds,
        tickedIds: checked.tickedIds,
      });
      if (changes.deleteAll) {
        await tx.choreAssignee.deleteMany({ where: { choreId: chore.id } });
      } else if (changes.deleteIds.length > 0) {
        await tx.choreAssignee.deleteMany({
          where: { choreId: chore.id, userId: { in: changes.deleteIds } },
        });
      }
      if (changes.insertIds.length > 0) {
        // skipDuplicates: the (choreId, userId) unique can't raise P2002.
        await tx.choreAssignee.createMany({
          data: changes.insertIds.map((id) => ({ choreId: chore.id, userId: id })),
          skipDuplicates: true,
        });
      }
    }
    return { kind: "saved" } as const;
  });

  if (outcome.kind === "caller-gone") {
    // The header's household items go too.
    revalidatePath("/", "layout");
    redirect("/household/new");
  }
  if (outcome.kind === "gone") return { values, formError: CHORE_GONE_ERROR };
  if (outcome.kind === "not-pending") return { values, formError: CHORE_NOT_PENDING_ERROR };
  if (outcome.kind === "refused") return refuse(choreId, values, outcome.chore, outcome.checked);

  revalidatePath("/");
  revalidatePath(CHORES_PATH);
  redirect(`${CHORES_PATH}?notice=saved`);
}

export async function deleteChore(
  _prev: DeleteChoreState,
  formData: FormData,
): Promise<DeleteChoreState> {
  // A member gets the refusal before any transaction. The guard's redirects
  // (signed out, no household) are rethrown untouched.
  let current;
  try {
    current = await requireAdmin();
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: ADMIN_ONLY_ERROR };
    throw error;
  }
  const householdId = current.household.id;
  const choreId = field(formData, "choreId");

  const outcome = await inHouseholdTransaction(
    householdId,
    current.membership.userId,
    async (tx, caller) => {
      // Re-checked under the lock: the role may have changed since.
      if (caller.role !== "admin") return { kind: "not-admin" } as const;
      if (!(await lockChore(tx, choreId, householdId))) return { kind: "gone" } as const;
      // Any status. The assignee, completion and skip rows go with it
      // (onDelete: Cascade); a next occurrence is its own chore and stays.
      await tx.chore.delete({ where: { id: choreId } });
      return { kind: "deleted" } as const;
    },
  );

  if (outcome.kind === "caller-gone") {
    revalidatePath("/", "layout");
    redirect("/household/new");
  }
  if (outcome.kind === "not-admin") return { error: ADMIN_ONLY_ERROR };
  revalidatePath("/");
  revalidatePath(CHORES_PATH);
  if (outcome.kind === "gone") return { error: CHORE_GONE_ERROR };
  redirect(`${CHORES_PATH}?notice=deleted`);
}
