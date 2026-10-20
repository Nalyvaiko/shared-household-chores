"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CHORE_CATEGORY_GONE_ERROR } from "@/app/chores/new/messages";
import { requireHousehold, type CurrentHousehold } from "@/lib/auth/guards";
import {
  choreTitleSchema,
  effortSchema,
  parseDueAt,
  prioritySchema,
} from "@/lib/chore/validation";
import { db } from "@/lib/db";

/** What the user entered, echoed back so the form keeps it after a refusal. */
export type ChoreFormValues = {
  title: string;
  dueAtLocal: string;
  priority: string;
  effort: string;
  categoryId: string;
};

export type CreateChoreState = {
  values: ChoreFormValues;
  errors?: {
    title?: string[];
    dueAt?: string[];
    priority?: string[];
    effort?: string[];
    categoryId?: string[];
  };
};

const NEW_CHORE_PATH = "/chores/new";
const CHORES_PATH = "/chores";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
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

export async function createChore(
  _prev: CreateChoreState,
  formData: FormData,
): Promise<CreateChoreState> {
  // The household comes from the caller's membership and the creator from the
  // session, never from the form. Only the fields below are read; anything
  // else posted (status, householdId, assignees, …) is ignored. Redirects
  // throw, so they stay outside try and the transaction callback.
  const current = await requireHousehold();
  const householdId = current.household.id;

  const values: ChoreFormValues = {
    title: field(formData, "title"),
    dueAtLocal: field(formData, "dueAtLocal"),
    priority: field(formData, "priority"),
    effort: field(formData, "effort"),
    categoryId: field(formData, "categoryId"),
  };

  const title = choreTitleSchema.safeParse(values.title);
  const dueAt = parseDueAt(field(formData, "dueAt"), values.dueAtLocal);
  const priority = prioritySchema.safeParse(values.priority);
  const effort = effortSchema.safeParse(values.effort);

  if (!title.success || !dueAt.success || !priority.success || !effort.success) {
    const errors: NonNullable<CreateChoreState["errors"]> = {};
    if (!title.success) errors.title = title.error.issues.map((issue) => issue.message);
    if (!dueAt.success) errors.dueAt = [dueAt.error];
    if (!priority.success) errors.priority = priority.error.issues.map((issue) => issue.message);
    if (!effort.success) errors.effort = effort.error.issues.map((issue) => issue.message);
    // Checked here too so every invalid field is reported at once. Nothing is
    // written, so this read needs no lock.
    if (values.categoryId && !(await categoryBelongs(db, values.categoryId, householdId))) {
      return categoryGone(values, errors);
    }
    return { values, errors };
  }

  const categoryId = values.categoryId || null;
  const outcome = await db.$transaction(async (tx) => {
    const caller = await lockAndReadCaller(tx, current);
    if (!caller) return "gone" as const;

    // Under the lock, so the category can't be deleted between check and insert.
    if (categoryId && !(await categoryBelongs(tx, categoryId, householdId))) {
      return "category-gone" as const;
    }

    await tx.chore.create({
      data: {
        householdId,
        createdById: current.membership.userId,
        title: title.data,
        dueAt: dueAt.dueAt,
        priority: priority.data,
        effort: effort.data,
        categoryId,
        status: "pending",
        recurrence: "none",
        assignmentMode: "fixed",
      },
    });
    return "created" as const;
  });

  if (outcome === "gone") {
    // The header's household items go too.
    revalidatePath("/", "layout");
    redirect("/household/new");
  }
  if (outcome === "category-gone") return categoryGone(values, {});

  revalidatePath(CHORES_PATH);
  redirect(CHORES_PATH);
}

/**
 * Refuses a category that is gone. The page is revalidated so the select is
 * re-rendered with the current list, and the echoed choice becomes None.
 */
function categoryGone(
  values: ChoreFormValues,
  errors: NonNullable<CreateChoreState["errors"]>,
): CreateChoreState {
  revalidatePath(NEW_CHORE_PATH);
  return {
    values: { ...values, categoryId: "" },
    errors: { ...errors, categoryId: [CHORE_CATEGORY_GONE_ERROR] },
  };
}
