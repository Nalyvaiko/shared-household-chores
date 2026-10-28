import type { Metadata } from "next";
import Link from "next/link";

import { choreNoticeText } from "@/app/chores/[id]/edit/messages";
import { ChoreFeedbackProvider } from "@/components/chore-feedback";
import { ChoreList } from "@/components/chore-list";
import { ClaimChoreButton } from "@/components/claim-chore-button";
import { CompleteChoreButton } from "@/components/complete-chore-button";
import { ReleaseChoreButton } from "@/components/release-chore-button";
import { SkipChoreForm } from "@/components/skip-chore-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { nativeSelectClassName } from "@/components/ui/native-select";
import { requireHousehold, requireUser } from "@/lib/auth/guards";
import { sortCategories } from "@/lib/category/sort";
import { canClaim, canRelease } from "@/lib/chore/claim";
import { canComplete } from "@/lib/chore/complete";
import { STATUS_OPTIONS } from "@/lib/chore/labels";
import {
  CHORE_LIST_ORDER_BY,
  choreListInclude,
  choreListWhere,
  parseChoreFilters,
  type ChoreFilters,
} from "@/lib/chore/list";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Chores · Shared Household Chores",
};

const STATUS_FILTER_OPTIONS = [...STATUS_OPTIONS, { value: "all", label: "All" }];

/** A GET form, so filtering works without JavaScript and lives in the URL. */
function ChoreFilterForm({
  filters,
  categories,
}: {
  filters: ChoreFilters;
  categories: { id: string; name: string }[];
}) {
  return (
    <form
      method="get"
      action="/chores"
      className="flex w-full flex-wrap items-end gap-4 rounded-md border px-4 py-3"
    >
      <div className="flex min-w-36 flex-col gap-2">
        <Label htmlFor="filter-status">Status</Label>
        <select
          id="filter-status"
          name="status"
          defaultValue={filters.status}
          className={nativeSelectClassName}
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-44 flex-col gap-2">
        <Label htmlFor="filter-category">Category</Label>
        <select
          id="filter-category"
          name="category"
          defaultValue={filters.category ?? ""}
          className={nativeSelectClassName}
        >
          <option value="">All categories</option>
          <option value="none">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex h-9 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="overdue"
          value="1"
          defaultChecked={filters.overdueOnly}
          className="size-4 accent-primary"
        />
        Overdue only
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        <Link href="/chores" className="text-sm underline underline-offset-4">
          Clear filters
        </Link>
      </div>
    </form>
  );
}

export default async function ChoresPage({ searchParams }: PageProps<"/chores">) {
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  const user = await requireUser({ callbackUrl: "/chores" });
  const { household, membership } = await requireHousehold();
  const isAdmin = membership.role === "admin";
  // One "now" per request, for both the overdue filter and the badges.
  const now = new Date();

  const categories = sortCategories(
    await db.category.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, builtIn: true },
    }),
  );
  const params = await searchParams;
  const filters = parseChoreFilters(
    params,
    categories.map((category) => category.id),
  );
  // After a save or delete on the edit page; any other value shows nothing.
  const notice = choreNoticeText(params.notice);

  const chores = await db.chore.findMany({
    where: choreListWhere(household.id, filters, now),
    include: choreListInclude(household.id),
    orderBy: CHORE_LIST_ORDER_BY,
  });
  // Only an empty result needs to know whether the household has chores at all.
  const householdHasChores =
    chores.length > 0 || (await db.chore.count({ where: { householdId: household.id } })) > 0;

  return (
    <section className="flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Household chores</h1>
      <Button asChild>
        <Link href="/chores/new">New chore</Link>
      </Button>
      {/* A client-side navigation (Clear filters, Show all chores, any link to
          /chores) keeps the DOM, and React doesn't re-apply defaultValue, so
          edits that were never applied would survive it. Keyed on this
          request's time, the form remounts with the effective filters on
          every render from the server, even when the filters didn't change. */}
      <ChoreFilterForm
        key={now.toISOString()}
        filters={filters}
        categories={categories.map(({ id, name }) => ({ id, name }))}
      />
      {/* Separate from the row actions' messages below. The filter form and
          "Clear filters" don't carry `notice`, so it goes with them. */}
      {notice ? (
        <p role="status" className="w-full rounded-md border px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}
      {/* Unkeyed (unlike the form above) and outside the branches below, so
          the outcome message survives the re-render, the completed row
          leaving, and the list becoming empty. */}
      <ChoreFeedbackProvider>
        {chores.length > 0 ? (
          <ChoreList
            chores={chores}
            viewerId={user.id}
            now={now}
            // Complete only on the viewer's pending assigned or claimed chores (admins
            // too); Release only to a holder of the claim; Claim on a claim chore
            // no current member holds; Skip on every pending chore. A claimable
            // chore has no row for the viewer, so Claim never meets Complete or
            // Release.
            actions={(chore) =>
              chore.status === "pending" ? (
                <>
                  {canComplete(chore, user.id) ? (
                    <CompleteChoreButton choreId={chore.id} title={chore.title} />
                  ) : null}
                  {canRelease(chore, user.id) ? (
                    <ReleaseChoreButton choreId={chore.id} title={chore.title} />
                  ) : null}
                  {canClaim(chore) ? (
                    <ClaimChoreButton choreId={chore.id} title={chore.title} />
                  ) : null}
                  {/* Any member may skip any pending chore. */}
                  <SkipChoreForm
                    choreId={chore.id}
                    title={chore.title}
                    recurring={chore.recurrence !== "none"}
                  />
                  {/* Any member may edit any pending chore. */}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/chores/${chore.id}/edit`}>
                      Edit<span className="sr-only"> &quot;{chore.title}&quot;</span>
                    </Link>
                  </Button>
                </>
              ) : isAdmin ? (
                // Only admins may delete; the delete is confirmed on the edit page.
                <Button asChild size="sm" variant="outline">
                  <Link href={`/chores/${chore.id}/edit`}>
                    Delete<span className="sr-only"> &quot;{chore.title}&quot;</span>
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : householdHasChores ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted-foreground">No chores match these filters.</p>
            <Link href="/chores?status=all" className="text-sm underline underline-offset-4">
              Show all chores
            </Link>
          </div>
        ) : (
          <p className="text-muted-foreground">No chores yet.</p>
        )}
      </ChoreFeedbackProvider>
    </section>
  );
}
