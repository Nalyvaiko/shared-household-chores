import type { Metadata } from "next";
import { headers } from "next/headers";

import { InviteSection } from "@/app/household/members/invite-section";
import { RemoveMemberButton } from "@/app/household/members/remove-member-button";
import { requireHousehold, requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  activeInviteWhere,
  formatExpiry,
  inviteUrl,
  resolveOrigin,
} from "@/lib/household/invite";

export const metadata: Metadata = {
  title: "Members · Shared Household Chores",
};

const ROLE_LABELS = { admin: "Admin", member: "Member" } as const;

async function loadActiveInvite(householdId: string) {
  const invite = await db.inviteToken.findFirst({
    where: activeInviteWhere(householdId, new Date()),
    orderBy: { createdAt: "desc" },
    select: { token: true, expiresAt: true },
  });
  if (!invite) return null;

  // The origin is worked out per request, never stored.
  const origin = resolveOrigin(await headers());
  return { url: inviteUrl(origin, invite.token), expiresLabel: formatExpiry(invite.expiresAt) };
}

export default async function MembersPage() {
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  await requireUser({ callbackUrl: "/household/members" });
  const { household, membership } = await requireHousehold();
  const isAdmin = membership.role === "admin";

  const memberships = await db.membership.findMany({
    where: { householdId: household.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      user: { select: { name: true, email: true } },
    },
  });
  // Only an admin's page ever loads the token, so a member's HTML can't contain it.
  const invite = isAdmin ? await loadActiveInvite(household.id) : null;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground">Everyone in {household.name}.</p>
      </div>

      <ul className="flex flex-col divide-y rounded-md border">
        {memberships.map((row) => {
          const displayName = row.user.name || row.user.email;
          const isSelf = row.id === membership.id;
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-medium break-words">
                  {displayName}
                  {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                </span>
                <span className="text-sm break-all text-muted-foreground">
                  {row.user.email}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">{ROLE_LABELS[row.role]}</span>
                {isAdmin && !isSelf ? (
                  <RemoveMemberButton membershipId={row.id} displayName={displayName} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {isAdmin ? (
        <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
          <h2 id="invite-heading" className="text-lg font-semibold">
            Invite link
          </h2>
          <p className="text-sm text-muted-foreground">
            Share this link with someone to let them join as a member. Regenerating it
            stops the old link from working.
          </p>
          <InviteSection invite={invite} />
        </section>
      ) : null}
    </section>
  );
}
