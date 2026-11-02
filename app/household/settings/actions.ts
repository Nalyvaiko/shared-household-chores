"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ADMIN_ONLY_ERROR,
  HOUSEHOLD_RENAMED_MESSAGE,
} from "@/app/household/settings/messages";
import { ForbiddenError, requireAdmin, type CurrentHousehold } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { householdNameSchema } from "@/lib/household/validation";

export type RenameHouseholdState = {
  /** What the input shows: the typed value after a refusal, the saved name after a success. */
  name: string;
  error?: string;
  success?: string;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * `requireAdmin()`, but a `member` gets `null` instead of an exception, so the
 * action can answer with form state. Every other error, including the
 * redirects for signed-out or household-less callers, is rethrown untouched.
 */
async function adminOrNull(): Promise<CurrentHousehold | null> {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof ForbiddenError) return null;
    throw error;
  }
}

export async function renameHousehold(
  _prev: RenameHouseholdState,
  formData: FormData,
): Promise<RenameHouseholdState> {
  // The household comes from the caller's membership, never from the form.
  // Redirects throw, so they stay outside try and the transaction callback.
  const enteredName = field(formData, "name");
  const current = await adminOrNull();
  if (!current) return { name: enteredName, error: ADMIN_ONLY_ERROR };
  const householdId = current.household.id;

  const parsed = householdNameSchema.safeParse(enteredName);
  if (!parsed.success) {
    return { name: enteredName, error: parsed.error.issues[0]?.message };
  }
  const name = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    // The same household lock the members and categories pages use; then the
    // caller is re-read, as they may have been removed or demoted meanwhile.
    await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;
    const caller = await tx.membership.findUnique({
      where: { userId_householdId: { userId: current.membership.userId, householdId } },
    });
    if (!caller) return "gone" as const;
    if (caller.role !== "admin") return "forbidden" as const;

    // An unchanged name is saved too; it is still a success.
    await tx.household.update({ where: { id: householdId }, data: { name } });
    return "renamed" as const;
  });

  if (outcome === "gone") {
    revalidatePath("/", "layout");
    redirect("/household/new");
  }
  if (outcome === "forbidden") return { name: enteredName, error: ADMIN_ONLY_ERROR };

  // The header shows the household name on every page.
  revalidatePath("/", "layout");
  return { name, success: HOUSEHOLD_RENAMED_MESSAGE };
}
