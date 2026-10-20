import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireHousehold, requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Chores · Shared Household Chores",
};

// A placeholder so the create redirect lands somewhere. #15 replaces it with
// the real household list.
export default async function ChoresPage() {
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  await requireUser({ callbackUrl: "/chores" });
  const { household } = await requireHousehold();

  const chores = await db.chore.findMany({
    where: { householdId: household.id },
    select: { id: true, title: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return (
    <section className="flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Household chores</h1>
      <Button asChild>
        <Link href="/chores/new">New chore</Link>
      </Button>
      {chores.length === 0 ? (
        <p className="text-muted-foreground">No chores yet.</p>
      ) : (
        <ul className="flex w-full flex-col divide-y rounded-md border">
          {chores.map((chore) => (
            <li key={chore.id} className="px-4 py-3 break-words">
              {chore.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
