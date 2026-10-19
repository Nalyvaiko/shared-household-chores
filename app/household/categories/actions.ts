"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CATEGORY_BUILTIN_ERROR,
  CATEGORY_DUPLICATE_ERROR,
  CATEGORY_GONE_ERROR,
} from "@/app/household/categories/messages";
import { requireHousehold, type CurrentHousehold } from "@/lib/auth/guards";
import { categoryNameSchema, sameCategoryName } from "@/lib/category/validation";
import { db } from "@/lib/db";

export type AddCategoryState = {
  /** What the user typed, so the form can keep it. Empty after a success. */
  name: string;
  error?: string;
};

export type DeleteCategoryState = {
  /** A message to show next to the row's Delete control. */
  error?: string;
};

const CATEGORIES_PATH = "/household/categories";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Locks the household row so that category changes for one household run one
 * at a time (the same lock the members page uses), then re-reads the caller's
 * membership: an admin may have removed them since the request started.
 */
async function lockAndReadCaller(tx: Prisma.TransactionClient, current: CurrentHousehold) {
  const householdId = current.household.id;
  await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;
  return tx.membership.findUnique({
    where: { userId_householdId: { userId: current.membership.userId, householdId } },
  });
}

/** The caller left the household mid-request: refresh, then send them on. */
function leaveForNewHousehold(): never {
  revalidatePath(CATEGORIES_PATH);
  // The header's household items go too.
  revalidatePath("/", "layout");
  redirect("/household/new");
}

function isUniqueViolation(error: unknown): boolean {
  // `Category`'s only unique constraint besides `id` is (householdId, name).
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function addCategory(
  _prev: AddCategoryState,
  formData: FormData,
): Promise<AddCategoryState> {
  // The household comes from the caller's membership, never from the form.
  // Redirects throw, so they stay outside try and the transaction callback.
  const current = await requireHousehold();
  const householdId = current.household.id;

  const enteredName = field(formData, "name");
  const parsed = categoryNameSchema.safeParse(enteredName);
  if (!parsed.success) {
    revalidatePath(CATEGORIES_PATH);
    return { name: enteredName, error: parsed.error.issues[0]?.message };
  }
  const name = parsed.data;

  let outcome: "gone" | "duplicate" | "created";
  try {
    outcome = await db.$transaction(async (tx) => {
      const caller = await lockAndReadCaller(tx, current);
      if (!caller) return "gone" as const;

      // Under the lock, so a concurrent "Garden" / "garden" pair can't both pass.
      const existing = await tx.category.findMany({
        where: { householdId },
        select: { name: true },
      });
      if (existing.some((category) => sameCategoryName(category.name, name))) {
        return "duplicate" as const;
      }

      await tx.category.create({ data: { householdId, name, builtIn: false } });
      return "created" as const;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    outcome = "duplicate";
  }

  if (outcome === "gone") leaveForNewHousehold();
  revalidatePath(CATEGORIES_PATH);
  if (outcome === "duplicate") return { name: enteredName, error: CATEGORY_DUPLICATE_ERROR };
  return { name: "" };
}

export async function deleteCategory(
  _prev: DeleteCategoryState,
  formData: FormData,
): Promise<DeleteCategoryState> {
  const current = await requireHousehold();
  const householdId = current.household.id;
  const categoryId = field(formData, "categoryId");

  const outcome = await db.$transaction(async (tx) => {
    const caller = await lockAndReadCaller(tx, current);
    if (!caller) return "gone" as const;

    const category = categoryId
      ? await tx.category.findUnique({ where: { id: categoryId } })
      : null;
    // Another household's id gets the same answer as an unknown one.
    if (!category || category.householdId !== householdId) return "missing" as const;
    if (category.builtIn) return "built-in" as const;

    // Chores that pointed at it get `categoryId` = null from the foreign key's
    // ON DELETE SET NULL; they are not updated here.
    await tx.category.delete({ where: { id: category.id } });
    return "deleted" as const;
  });

  if (outcome === "gone") leaveForNewHousehold();
  // Also after a refusal, so a row someone else already deleted disappears.
  revalidatePath(CATEGORIES_PATH);
  switch (outcome) {
    case "missing":
      return { error: CATEGORY_GONE_ERROR };
    case "built-in":
      return { error: CATEGORY_BUILTIN_ERROR };
    case "deleted":
      return {};
  }
}
