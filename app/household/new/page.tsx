import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HouseholdForm } from "@/app/household/new/household-form";
import { getCurrentHousehold, requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Create household · Shared Household Chores",
};

export default async function NewHouseholdPage() {
  // Not requireHousehold(): it sends household-less users here, so it would loop.
  await requireUser({ callbackUrl: "/household/new" });
  if (await getCurrentHousehold()) redirect("/");

  return (
    <section className="flex flex-col items-start gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create your household</h1>
        <p className="text-muted-foreground">
          Give your household a name. You&rsquo;ll be its admin and can invite others later.
        </p>
      </div>
      <HouseholdForm />
    </section>
  );
}
