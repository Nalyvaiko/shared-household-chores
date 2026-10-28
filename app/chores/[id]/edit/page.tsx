import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { updateChore } from "@/app/chores/[id]/edit/actions";
import { DeleteChoreForm } from "@/app/chores/[id]/edit/delete-chore-form";
import {
  ASSIGNMENT_READ_ONLY_TEXT,
  CHORE_NOT_EDITABLE_TEXT,
} from "@/app/chores/[id]/edit/messages";
import { ChoreForm, type MemberOption } from "@/app/chores/new/chore-form";
import { requireHousehold, requireUser } from "@/lib/auth/guards";
import { sortCategories } from "@/lib/category/sort";
import { canChangeAssignment } from "@/lib/chore/edit";
import { assignmentModeLabel } from "@/lib/chore/labels";
import { assigneeLine, choreListInclude } from "@/lib/chore/list";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Edit chore · Shared Household Chores",
};

export default async function EditChorePage({ params }: PageProps<"/chores/[id]/edit">) {
  const { id } = await params;
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  await requireUser({ callbackUrl: `/chores/${encodeURIComponent(id)}/edit` });
  const { household, membership } = await requireHousehold();

  // Unknown, empty and other households' ids all get the same 404.
  const chore = id
    ? await db.chore.findFirst({
        where: { id, householdId: household.id },
        include: choreListInclude(household.id),
      })
    : null;
  if (!chore) notFound();

  const isAdmin = membership.role === "admin";
  const deleteControl = isAdmin ? (
    <DeleteChoreForm
      choreId={chore.id}
      title={chore.title}
      recurring={chore.status === "pending" && chore.recurrence !== "none"}
    />
  ) : null;

  if (chore.status !== "pending") {
    return (
      <section className="flex flex-col items-start gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Edit chore</h1>
        <p>{CHORE_NOT_EDITABLE_TEXT}</p>
        <Link href="/chores" className="text-sm underline underline-offset-4">
          Back to chores
        </Link>
        {deleteControl}
      </section>
    );
  }

  const categories = sortCategories(
    await db.category.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, builtIn: true },
    }),
  ).map(({ id: categoryId, name }) => ({ id: categoryId, name }));

  // The members page query and order, as on /chores/new.
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

  // Only current members can be ticked; former members' rows stay as they are.
  const memberIds = new Set(members.map((member) => member.userId));
  const assigneeIds =
    chore.assignmentMode === "fixed"
      ? chore.assignees.map((a) => a.userId).filter((userId) => memberIds.has(userId))
      : [];

  return (
    <section className="flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit chore</h1>
      <ChoreForm
        categories={categories}
        members={members}
        action={updateChore}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        choreId={chore.id}
        cancelHref="/chores"
        storedDueAt={chore.dueAt ? chore.dueAt.toISOString() : null}
        values={{
          title: chore.title,
          // Filled in the browser's zone after hydration.
          dueAtLocal: "",
          priority: chore.priority,
          effort: chore.effort,
          categoryId: chore.categoryId ?? "",
          recurrence: chore.recurrence,
          assignmentMode: chore.assignmentMode,
          assigneeIds,
        }}
        assignmentReadOnly={
          canChangeAssignment(chore, membership)
            ? undefined
            : {
                modeLabel: assignmentModeLabel(chore.assignmentMode),
                assigneeLine: assigneeLine(chore, membership.userId),
                note: ASSIGNMENT_READ_ONLY_TEXT,
              }
        }
      />
      {deleteControl}
    </section>
  );
}
