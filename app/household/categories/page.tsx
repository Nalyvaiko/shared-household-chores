import type { Metadata } from "next";

import { AddCategoryForm } from "@/app/household/categories/add-category-form";
import { DeleteCategoryButton } from "@/app/household/categories/delete-category-button";
import { requireHousehold, requireUser } from "@/lib/auth/guards";
import { sortCategories } from "@/lib/category/sort";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Categories · Shared Household Chores",
};

export default async function CategoriesPage() {
  // requireUser() first: requireHousehold() alone would drop the callbackUrl.
  await requireUser({ callbackUrl: "/household/categories" });
  const { household } = await requireHousehold();

  const categories = sortCategories(
    await db.category.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, builtIn: true },
    }),
  );
  const hasCustom = categories.some((category) => !category.builtIn);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
        <p className="text-muted-foreground">
          Categories for chores in {household.name}. Built-in categories can&rsquo;t be
          deleted.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y rounded-md border">
          {categories.map((category) => (
            <li
              key={category.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0 font-medium break-words">{category.name}</span>
              {category.builtIn ? (
                <span className="text-sm text-muted-foreground">Built-in</span>
              ) : (
                <DeleteCategoryButton categoryId={category.id} name={category.name} />
              )}
            </li>
          ))}
        </ul>
        {hasCustom ? null : (
          <p className="text-sm text-muted-foreground">No custom categories yet.</p>
        )}
      </div>

      <section aria-labelledby="add-category-heading" className="flex flex-col gap-3">
        <h2 id="add-category-heading" className="text-lg font-semibold">
          Add a category
        </h2>
        <AddCategoryForm />
      </section>
    </section>
  );
}
