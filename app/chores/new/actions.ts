"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CHORE_ASSIGNEE_GONE_ERROR,
  CHORE_CATEGORY_GONE_ERROR,
} from "@/app/chores/new/messages";
import { requireHousehold, type CurrentHousehold } from "@/lib/auth/guards";
import {
  assignmentModeSchema,
  choreTitleSchema,
  effortSchema,
  parseDueAt,
  prioritySchema,
  recurrenceSchema,
} from "@/lib/chore/validation";
import { db } from "@/lib/db";

/** What the user entered, echoed back so the form keeps it after a refusal. */
export type ChoreFormValues = {
  title: string;
  dueAtLocal: string;
  priority: string;
  effort: string;
  categoryId: string;
  recurrence: string;
  assignmentMode: string;
  /** User ids of the ticked members. Always empty in Claim mode. */
  assigneeIds: string[];
};

export type CreateChoreState = {
  values: ChoreFormValues;
  errors?: {
    title?: string[];
    dueAt?: string[];
    priority?: string[];
    effort?: string[];
    categoryId?: string[];
    recurrence?: string[];
    assignmentMode?: string[];
    assigneeIds?: string[];
  };
};

type ChoreErrors = NonNullable<CreateChoreState["errors"]>;

const NEW_CHORE_PATH = "/chores/new";
const CHORES_PATH = "/chores";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Every submitted assignee id, once each. A non-string value counts as empty. */
function assigneeIdsField(formData: FormData): string[] {
  const ids = formData
    .getAll("assigneeIds")
    .map((value) => (typeof value === "string" ? value : ""));
  return [...new Set(ids)];
}

/**
 * Locks the household row (the same lock the categories and members actions
 * take), then re-reads the caller's membership: an admin may have removed
 * them since the request started.
 */
async function lockAndReadCaller(tx: Prisma.TransactionClient, current: CurrentHousehold) {
  const householdId = current.household.id;
  await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;
  return tx.membership.findUnique({
    where: { userId_householdId: { userId: current.membership.userId, householdId } },
  });
}

/** Whether the id names one of this household's categories. */
async function categoryBelongs(
  client: Pick<Prisma.TransactionClient, "category">,
  categoryId: string,
  householdId: string,
): Promise<boolean> {
  const category = await client.category.findUnique({ where: { id: categoryId } });
  // Another household's id gets the same answer as an unknown one.
  return category !== null && category.householdId === householdId;
}

/**
 * The ids that are not a current member of the household: unknown, empty,
 * another household's user, or removed. Older assignee rows don't count.
 */
async function nonMemberIds(
  client: Pick<Prisma.TransactionClient, "membership">,
  userIds: string[],
  householdId: string,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await client.membership.findMany({
    where: { householdId, userId: { in: userIds } },
    select: { userId: true },
  });
  const members = new Set(rows.map((row) => row.userId));
  return userIds.filter((id) => !members.has(id));
}

export async function createChore(
  _prev: CreateChoreState,
  formData: FormData,
): Promise<CreateChoreState> {
  // The household comes from the caller's membership and the creator from the
  // session, never from the form. Only the fields below are read; anything
  // else posted (status, householdId, …) is ignored. Redirects throw, so they
  // stay outside try and the transaction callback.
  const current = await requireHousehold();
  const householdId = current.household.id;

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

  const title = choreTitleSchema.safeParse(values.title);
  const dueAt = parseDueAt(field(formData, "dueAt"), values.dueAtLocal);
  const priority = prioritySchema.safeParse(values.priority);
  const effort = effortSchema.safeParse(values.effort);
  const recurrence = recurrenceSchema.safeParse(values.recurrence);
  const assignmentMode = assignmentModeSchema.safeParse(values.assignmentMode);
  // Only a valid Fixed mode reads the ticked members.
  const assigneeIds =
    assignmentMode.success && assignmentMode.data === "fixed" ? values.assigneeIds : [];

  if (
    !title.success ||
    !dueAt.success ||
    !priority.success ||
    !effort.success ||
    !recurrence.success ||
    !assignmentMode.success
  ) {
    const errors: ChoreErrors = {};
    if (!title.success) errors.title = title.error.issues.map((issue) => issue.message);
    if (!dueAt.success) errors.dueAt = [dueAt.error];
    if (!priority.success) errors.priority = priority.error.issues.map((issue) => issue.message);
    if (!effort.success) errors.effort = effort.error.issues.map((issue) => issue.message);
    if (!recurrence.success) {
      errors.recurrence = recurrence.error.issues.map((issue) => issue.message);
    }
    if (!assignmentMode.success) {
      errors.assignmentMode = assignmentMode.error.issues.map((issue) => issue.message);
    }
    // Checked here too so every invalid field is reported at once. Nothing is
    // written, so these reads need no lock.
    const categoryGone =
      values.categoryId !== "" && !(await categoryBelongs(db, values.categoryId, householdId));
    const goneIds = await nonMemberIds(db, assigneeIds, householdId);
    return refuse(values, errors, { categoryGone, goneIds });
  }

  const categoryId = values.categoryId || null;
  const outcome = await db.$transaction(async (tx) => {
    const caller = await lockAndReadCaller(tx, current);
    if (!caller) return { kind: "gone" } as const;

    // Under the lock, so neither the category nor a picked member can go
    // between the check and the insert (member removal takes the same lock).
    const categoryGone =
      categoryId !== null && !(await categoryBelongs(tx, categoryId, householdId));
    const goneIds = await nonMemberIds(tx, assigneeIds, householdId);
    if (categoryGone || goneIds.length > 0) {
      return { kind: "refused", categoryGone, goneIds } as const;
    }

    const chore = await tx.chore.create({
      data: {
        householdId,
        createdById: current.membership.userId,
        title: title.data,
        dueAt: dueAt.dueAt,
        priority: priority.data,
        effort: effort.data,
        categoryId,
        status: "pending",
        recurrence: recurrence.data,
        assignmentMode: assignmentMode.data,
      },
    });
    if (assigneeIds.length > 0) {
      await tx.choreAssignee.createMany({
        data: assigneeIds.map((userId) => ({ choreId: chore.id, userId })),
      });
    }
    return { kind: "created" } as const;
  });

  if (outcome.kind === "gone") {
    // The header's household items go too.
    revalidatePath("/", "layout");
    redirect("/household/new");
  }
  if (outcome.kind === "refused") return refuse(values, {}, outcome);

  revalidatePath(CHORES_PATH);
  redirect(CHORES_PATH);
}

/**
 * Builds a refusal. A category or picked member that is gone gets its message,
 * and the page is revalidated so the select and the member list re-render with
 * the current rows: the gone category becomes None and the gone ids are
 * dropped from the echo, while the other ticks are kept.
 */
function refuse(
  values: ChoreFormValues,
  errors: ChoreErrors,
  { categoryGone, goneIds }: { categoryGone: boolean; goneIds: readonly string[] },
): CreateChoreState {
  if (!categoryGone && goneIds.length === 0) return { values, errors };

  revalidatePath(NEW_CHORE_PATH);
  const echoed = { ...values };
  const allErrors = { ...errors };
  if (categoryGone) {
    echoed.categoryId = "";
    allErrors.categoryId = [CHORE_CATEGORY_GONE_ERROR];
  }
  if (goneIds.length > 0) {
    echoed.assigneeIds = values.assigneeIds.filter((id) => !goneIds.includes(id));
    allErrors.assigneeIds = [CHORE_ASSIGNEE_GONE_ERROR];
  }
  return { values: echoed, errors: allErrors };
}
