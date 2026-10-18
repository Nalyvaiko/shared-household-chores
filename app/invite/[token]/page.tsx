import type { Metadata } from "next";
import Link from "next/link";

import { JoinForm } from "@/app/invite/[token]/join-form";
import { INVITE_PROBLEM_MESSAGES, type InviteProblem } from "@/app/invite/[token]/messages";
import { getCurrentHousehold, requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { inviteStatus, isWellFormedInviteToken } from "@/lib/household/invite";

export const metadata: Metadata = {
  title: "Join household · Shared Household Chores",
  // Invite links are private; keep them out of search results.
  robots: { index: false, follow: false },
};

function Problem({ problem }: { problem: InviteProblem }) {
  const message = INVITE_PROBLEM_MESSAGES[problem];
  return (
    <section className="flex flex-col items-start gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{message.title}</h1>
      <p className="text-muted-foreground">{message.body}</p>
    </section>
  );
}

// Read-only: rendering this page never writes, so link previews, crawlers and
// prefetches cannot use up a link. Joining happens only in `joinHousehold`.
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  // A malformed token never reaches the database.
  if (!isWellFormedInviteToken(token)) return <Problem problem="unknown" />;

  // Before any lookup, so a signed-out visitor learns nothing about the token.
  await requireUser({ callbackUrl: `/invite/${token}` });

  const invite = await db.inviteToken.findUnique({
    where: { token },
    select: {
      householdId: true,
      consumedAt: true,
      expiresAt: true,
      household: { select: { name: true } },
    },
  });
  const current = invite ? await getCurrentHousehold() : null;
  const householdName = invite?.household.name ?? "";
  const status = inviteStatus(invite, current?.household.id ?? null, new Date());

  if (status === "member-here") {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          You&rsquo;re already a member of {householdName}
        </h1>
        <Link
          href="/"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Go to your chores
        </Link>
      </section>
    );
  }

  if (status === "valid") {
    return (
      <section className="flex flex-col items-start gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Join {householdName}
          </h1>
          <p className="text-muted-foreground">
            You&rsquo;ve been invited to join this household as a member.
          </p>
        </div>
        <JoinForm token={token} />
      </section>
    );
  }

  return <Problem problem={status} />;
}
