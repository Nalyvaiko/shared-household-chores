import { describe, expect, it } from "vitest";

import { addCategory, deleteCategory } from "@/app/household/categories/actions";
import { CATEGORY_DUPLICATE_ERROR } from "@/app/household/categories/messages";
import { db } from "@/lib/db";

import { createChore, createHousehold, createUser, form } from "./helpers";
import { asUser } from "./session";

async function adminWithHousehold() {
  const admin = await createUser("Admin");
  const household = await createHousehold(admin.id);
  return { admin, household };
}

const customNames = (householdId: string) =>
  db.category
    .findMany({ where: { householdId, builtIn: false }, select: { name: true } })
    .then((rows) => rows.map((row) => row.name));

describe("custom categories", () => {
  it("refuses a name that differs from an existing one only in case", async () => {
    const { admin, household } = await adminWithHousehold();
    await asUser(admin.id, () => addCategory({ name: "" }, form({ name: "Garden" })));

    const result = await asUser(admin.id, () =>
      addCategory({ name: "" }, form({ name: "gARDEN" })),
    );

    expect(result).toEqual({ name: "gARDEN", error: CATEGORY_DUPLICATE_ERROR });
    expect(await customNames(household.id)).toEqual(["Garden"]);
  });

  it("creates only one of several case variants added at once", async () => {
    const { admin, household } = await adminWithHousehold();
    const base = ["Garden", "garden", "GARDEN", "GaRdEn", "gARDEN", "GArden"];

    for (let round = 0; round < 5; round += 1) {
      const variants = base.map((name) => `${name} ${round}`);
      const results = await Promise.all(
        variants.map((name) => asUser(admin.id, () => addCategory({ name: "" }, form({ name })))),
      );

      expect(results.filter((r) => !r.error)).toEqual([{ name: "" }]);
      expect(results.filter((r) => r.error === CATEGORY_DUPLICATE_ERROR)).toHaveLength(
        variants.length - 1,
      );
    }
    const names = await customNames(household.id);
    expect(names).toHaveLength(5);
  });

  it("keeps the chores of a deleted category, with no category", async () => {
    const { admin, household } = await adminWithHousehold();
    const category = await db.category.create({
      data: { householdId: household.id, name: "Garage" },
    });
    const pending = await createChore(household.id, admin.id, { categoryId: category.id });
    const completed = await createChore(household.id, admin.id, {
      categoryId: category.id,
      status: "completed",
    });

    const result = await asUser(admin.id, () =>
      deleteCategory({}, form({ categoryId: category.id })),
    );

    expect(result).toEqual({});
    expect(await db.category.count({ where: { id: category.id } })).toBe(0);
    const chores = await db.chore.findMany({
      where: { id: { in: [pending.id, completed.id] } },
      select: { categoryId: true },
    });
    expect(chores).toEqual([{ categoryId: null }, { categoryId: null }]);
  });
});
