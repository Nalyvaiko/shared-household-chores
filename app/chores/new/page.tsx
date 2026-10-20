import type { Metadata } from "next";

import { ChoreForm } from "@/app/chores/new/chore-form";
import { requireHousehold, requireUser } from "@/lib/auth/guards";
import { sortCategories } from "@/lib/category/sort";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "New chore · Shared Household Chores",
};

export default async function NewChorePage() {
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  await requireUser({ callbackUrl: "/chores/new" });
  const { household } = await requireHousehold();

  const categories = sortCategories(
    await db.category.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, builtIn: true },
    }),
  ).map(({ id, name }) => ({ id, name }));

  return (
    <section className="flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New chore</h1>
      <ChoreForm categories={categories} />
    </section>
  );
}
