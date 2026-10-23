import Link from "next/link";

import { ChoreList } from "@/components/chore-list";
import { Button } from "@/components/ui/button";
import { requireHousehold } from "@/lib/auth/guards";
import { CHORE_LIST_ORDER_BY, choreListInclude, myChoresWhere } from "@/lib/chore/list";
import { db } from "@/lib/db";

export default async function Home() {
  // Signed out goes to /signin; no household yet goes to /household/new.
  const { household, membership } = await requireHousehold();
  const userId = membership.userId;
  // One "now" per request, for the overdue badges.
  const now = new Date();

  // Scoped to the current household explicitly: assignee rows can outlive a
  // membership elsewhere.
  const chores = await db.chore.findMany({
    where: myChoresWhere(household.id, userId),
    include: choreListInclude(household.id),
    orderBy: CHORE_LIST_ORDER_BY,
  });

  const allChoresLink = (
    <Link href="/chores" className="text-sm underline underline-offset-4">
      All household chores
    </Link>
  );

  return (
    <section className="flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">My chores</h1>
      <div className="flex flex-wrap items-center gap-4">
        <Button asChild>
          <Link href="/chores/new">New chore</Link>
        </Button>
        {chores.length > 0 ? allChoresLink : null}
      </div>
      {chores.length > 0 ? (
        <ChoreList chores={chores} viewerId={userId} now={now} />
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground">Nothing assigned to you right now.</p>
          {allChoresLink}
        </div>
      )}
    </section>
  );
}
