import type { Prisma, Role } from "@prisma/client";

import { db } from "@/lib/db";

/** Empties every application table (not `_prisma_migrations`). */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

let counter = 0;

export async function createUser(name = "User") {
  counter += 1;
  return db.user.create({
    data: { email: `${name.toLowerCase()}-${counter}@example.com`, name, passwordHash: "x" },
  });
}

/** A household with `admin` as its admin. */
export async function createHousehold(adminId: string, name = "Home") {
  const household = await db.household.create({ data: { name } });
  await addMember(household.id, adminId, "admin");
  return household;
}

export async function addMember(householdId: string, userId: string, role: Role = "member") {
  return db.membership.create({ data: { householdId, userId, role } });
}

/** A pending chore; `assignees` become its ChoreAssignee rows. */
export async function createChore(
  householdId: string,
  createdById: string,
  {
    assignees = [],
    ...data
  }: Partial<Omit<Prisma.ChoreUncheckedCreateInput, "assignees">> & { assignees?: string[] } = {},
) {
  return db.chore.create({
    data: {
      householdId,
      createdById,
      title: "Take out the bins",
      priority: "medium",
      effort: "small",
      ...data,
      assignees: { create: assignees.map((userId) => ({ userId })) },
    },
  });
}

export function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The redirect target when `promise` threw the mocked NEXT_REDIRECT, else rethrows. */
export async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const match = error instanceof Error && /^NEXT_REDIRECT (.*)$/.exec(error.message);
    if (match) return match[1];
    throw error;
  }
  throw new Error("Expected a redirect, but the action returned.");
}
