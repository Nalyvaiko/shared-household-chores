import type { Metadata } from "next";

import { ChoreForm, type MemberOption } from "@/app/chores/new/chore-form";
import { requireHousehold, requireUser } from "@/lib/auth/guards";
import { sortCategories } from "@/lib/category/sort";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "New chore · Shared Household Chores",
};

export default async function NewChorePage() {
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  await requireUser({ callbackUrl: "/chores/new" });
  const { household, membership } = await requireHousehold();

  const categories = sortCategories(
    await db.category.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, builtIn: true },
    }),
  ).map(({ id, name }) => ({ id, name }));

  // The members page query and order.
  const memberships = await db.membership.findMany({
    where: { householdId: household.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
  });
  const members: MemberOption[] = memberships.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    isSelf: row.id === membership.id,
  }));

  return (
    <section className="flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New chore</h1>
      <ChoreForm categories={categories} members={members} />
    </section>
  );
}
