import type { Metadata } from "next";

import { RenameHouseholdForm } from "@/app/household/settings/rename-household-form";
import { requireHousehold, requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Household settings · Shared Household Chores",
};

export default async function HouseholdSettingsPage() {
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  await requireUser({ callbackUrl: "/household/settings" });
  const { household, membership } = await requireHousehold();
  const isAdmin = membership.role === "admin";

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Household settings</h1>
        <p className="text-muted-foreground">Settings for {household.name}.</p>
      </div>

      {isAdmin ? (
        <RenameHouseholdForm currentName={household.name} />
      ) : (
        <div className="flex flex-col gap-2">
          <dl className="flex flex-col gap-1">
            <dt className="text-sm font-medium">Household name</dt>
            <dd className="break-words">{household.name}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">
            Only a household admin can rename the household.
          </p>
        </div>
      )}
    </section>
  );
}
