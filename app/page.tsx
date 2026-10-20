import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireHousehold } from "@/lib/auth/guards";

export default async function Home() {
  // Signed out goes to /signin; no household yet goes to /household/new.
  await requireHousehold();

  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Chores</h1>
      <p className="text-muted-foreground">
        Your household&rsquo;s chores will show up here.
      </p>
      <Button asChild>
        <Link href="/chores/new">New chore</Link>
      </Button>
    </section>
  );
}
