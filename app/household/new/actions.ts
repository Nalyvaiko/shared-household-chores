"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guards";
import { BUILTIN_CATEGORY_NAMES } from "@/lib/builtin-categories";
import { db } from "@/lib/db";
import { householdNameSchema } from "@/lib/household/validation";

export type CreateHouseholdState = {
  /** What the user typed, so the form can keep it. */
  name: string;
  errors?: {
    name?: string[];
  };
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createHousehold(
  _prev: CreateHouseholdState,
  formData: FormData,
): Promise<CreateHouseholdState> {
  // The user always comes from the session, never from the form. Redirects
  // throw, so this and every redirect below stay outside try and the
  // transaction callback.
  const user = await requireUser();

  const enteredName = field(formData, "name");
  const parsed = householdNameSchema.safeParse(enteredName);
  if (!parsed.success) {
    return {
      name: enteredName,
      errors: { name: parsed.error.issues.map((issue) => issue.message) },
    };
  }
  const name = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    // Locking the user's row serialises concurrent submits for the same user:
    // a second transaction waits here, then its re-check sees the membership
    // the first one created.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    if (locked.length === 0) return "user-deleted" as const;

    const existing = await tx.membership.findFirst({ where: { userId: user.id } });
    if (existing) return "already-member" as const;

    const household = await tx.household.create({ data: { name } });
    await tx.membership.create({
      data: { userId: user.id, householdId: household.id, role: "admin" },
    });
    await tx.category.createMany({
      data: BUILTIN_CATEGORY_NAMES.map((categoryName) => ({
        householdId: household.id,
        name: categoryName,
        builtIn: true,
      })),
    });
    return "created" as const;
  });

  if (outcome === "user-deleted") redirect("/signin");
  // Created now, or already in a household (an earlier submit or another tab).
  redirect("/");
}
