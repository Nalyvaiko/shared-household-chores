/**
 * Database seed (task #5).
 *
 * `npm run db:seed` -> `prisma db seed` -> this file (see the `prisma.seed` key
 * in package.json). It populates a fresh database with the built-in category set
 * and one demo household that exercises every chore state the later screens
 * need.
 *
 * The script is idempotent: it upserts on natural keys and uses fixed string IDs
 * for the rows that have none (the demo household and its chores), and the
 * `update` half of every upsert only ever writes the same stable values it would
 * create. Running it a second time changes nothing and exits 0. There is no
 * `deleteMany`/truncate.
 *
 * This is a standalone script in the Prisma-recommended shape: it constructs its
 * own `PrismaClient` and calls `$disconnect()` at the end. It does not import
 * `lib/db.ts` (that client is cached on `globalThis` for the Next.js runtime)
 * and it never calls the auth or password-hashing code — demo passwords are
 * seeded from pre-computed bcrypt hashes below.
 */
import {
  AssignmentMode,
  ChoreStatus,
  Effort,
  PrismaClient,
  Priority,
  RecurrenceFrequency,
  Role,
} from "@prisma/client";

import {
  BUILTIN_CATEGORY_NAMES,
  type BuiltinCategoryName,
} from "../lib/builtin-categories";

const prisma = new PrismaClient();

/** Fixed id for the demo household (no natural key of its own). */
const HOUSEHOLD_ID = "demo-household";

/**
 * The two demo users. Emails are the natural key. `passwordHash` is a
 * pre-computed bcrypt hash (cost 10, `$2b$`) so the seed has no dependency on
 * the hashing library (task #6) or the sign-up flow (task #7); the plaintext is
 * in the comment and in the README.
 */
const DEMO_USERS = {
  admin: {
    id: "demo-user-admin",
    email: "admin@example.com",
    name: "Demo Admin",
    // bcrypt(cost 10) of "sparkle-otter-42"
    passwordHash: "$2b$10$.duV/OFtwvaQODTpdcstAOE.cE2HFq59xJtvr4sWOL.J5S0VqwLcS",
  },
  member: {
    id: "demo-user-member",
    email: "member@example.com",
    name: "Demo Member",
    // bcrypt(cost 10) of "maple-badger-77"
    passwordHash: "$2b$10$rBguD18mpiLgxbcjFDu74uodFbaNCCy3U7S/b/VL1Xn63QBxMQuVa",
  },
} as const;

/**
 * Fixed sentinel due dates. They are absolute (not relative to `Date.now()`) so
 * a re-run writes byte-identical values. The past date makes a pending chore
 * render as overdue at read time; the future date keeps one clearly upcoming.
 */
const PAST_DUE_AT = new Date("2020-01-15T09:00:00.000Z");
const FUTURE_DUE_AT = new Date("2099-06-01T09:00:00.000Z");

type ChoreSeed = {
  id: string;
  title: string;
  priority: Priority;
  effort: Effort;
  createdById: string;
  categoryName: BuiltinCategoryName | null;
  dueAt: Date | null;
  status?: ChoreStatus;
  recurrence?: RecurrenceFrequency;
  assignmentMode?: AssignmentMode;
};

async function main() {
  // 1. Demo household — fixed id, no natural key.
  const household = await prisma.household.upsert({
    where: { id: HOUSEHOLD_ID },
    create: { id: HOUSEHOLD_ID, name: "Demo Household" },
    update: { name: "Demo Household" },
  });

  // 2. Built-in categories: one row per canonical name, scoped to the household.
  //    Natural key: (householdId, name).
  for (const name of BUILTIN_CATEGORY_NAMES) {
    await prisma.category.upsert({
      where: { householdId_name: { householdId: household.id, name } },
      create: { householdId: household.id, name, builtIn: true },
      update: { builtIn: true },
    });
  }

  const categories = await prisma.category.findMany({
    where: { householdId: household.id },
  });
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));

  // 3. Demo users. Natural key: email.
  const admin = await prisma.user.upsert({
    where: { email: DEMO_USERS.admin.email },
    create: { ...DEMO_USERS.admin },
    update: {
      name: DEMO_USERS.admin.name,
      passwordHash: DEMO_USERS.admin.passwordHash,
    },
  });
  const member = await prisma.user.upsert({
    where: { email: DEMO_USERS.member.email },
    create: { ...DEMO_USERS.member },
    update: {
      name: DEMO_USERS.member.name,
      passwordHash: DEMO_USERS.member.passwordHash,
    },
  });

  // 4. Membership: exactly one admin and one member in the demo household.
  //    Natural key: (userId, householdId).
  await prisma.membership.upsert({
    where: {
      userId_householdId: { userId: admin.id, householdId: household.id },
    },
    create: { userId: admin.id, householdId: household.id, role: Role.admin },
    update: { role: Role.admin },
  });
  await prisma.membership.upsert({
    where: {
      userId_householdId: { userId: member.id, householdId: household.id },
    },
    create: { userId: member.id, householdId: household.id, role: Role.member },
    update: { role: Role.member },
  });

  // 5. Chores — one per state the later screens need. Fixed ids (no natural
  //    key). Every chore sets title, priority, effort, householdId and
  //    createdById; createdById is always a demo user.
  const choreSeeds: ChoreSeed[] = [
    {
      id: "demo-chore-upcoming",
      title: "Wipe down the kitchen counters",
      priority: Priority.medium,
      effort: Effort.small,
      createdById: admin.id,
      categoryName: "Kitchen",
      dueAt: FUTURE_DUE_AT,
    },
    {
      id: "demo-chore-overdue",
      title: "Vacuum the living room",
      priority: Priority.high,
      effort: Effort.medium,
      createdById: member.id,
      categoryName: "Cleaning",
      dueAt: PAST_DUE_AT,
    },
    {
      id: "demo-chore-completed",
      title: "Take out the recycling",
      priority: Priority.low,
      effort: Effort.small,
      createdById: admin.id,
      categoryName: "Kitchen",
      dueAt: PAST_DUE_AT,
      status: ChoreStatus.completed,
    },
    {
      id: "demo-chore-skipped",
      title: "Mow the lawn",
      priority: Priority.medium,
      effort: Effort.large,
      createdById: admin.id,
      categoryName: "Outdoor",
      dueAt: PAST_DUE_AT,
      status: ChoreStatus.skipped,
    },
    {
      id: "demo-chore-recurring",
      title: "Water the plants",
      priority: Priority.medium,
      effort: Effort.medium,
      createdById: member.id,
      categoryName: "Cleaning",
      dueAt: FUTURE_DUE_AT,
      recurrence: RecurrenceFrequency.weekly,
    },
    {
      id: "demo-chore-claim",
      title: "Whoever's free: restock the pantry",
      priority: Priority.low,
      effort: Effort.small,
      createdById: admin.id,
      categoryName: "Kitchen",
      dueAt: FUTURE_DUE_AT,
      assignmentMode: AssignmentMode.claim,
    },
    {
      id: "demo-chore-fixed-assigned",
      title: "Deep-clean the bathroom",
      priority: Priority.high,
      effort: Effort.medium,
      createdById: admin.id,
      categoryName: "Bathroom",
      dueAt: FUTURE_DUE_AT,
      assignmentMode: AssignmentMode.fixed,
    },
  ];

  for (const seed of choreSeeds) {
    const data = {
      householdId: household.id,
      createdById: seed.createdById,
      categoryId: seed.categoryName
        ? (categoryIdByName.get(seed.categoryName) ?? null)
        : null,
      title: seed.title,
      dueAt: seed.dueAt,
      priority: seed.priority,
      effort: seed.effort,
      status: seed.status ?? ChoreStatus.pending,
      recurrence: seed.recurrence ?? RecurrenceFrequency.none,
      assignmentMode: seed.assignmentMode ?? AssignmentMode.fixed,
    };
    await prisma.chore.upsert({
      where: { id: seed.id },
      create: { id: seed.id, ...data },
      update: data,
    });
  }

  // 6. Chore children.

  // Fixed assignees for the fixed-assignment chore. Natural key: (choreId, userId).
  // The claim-mode chore ("demo-chore-claim") deliberately gets none.
  for (const userId of [admin.id, member.id]) {
    await prisma.choreAssignee.upsert({
      where: {
        choreId_userId: { choreId: "demo-chore-fixed-assigned", userId },
      },
      create: { choreId: "demo-chore-fixed-assigned", userId },
      update: {},
    });
  }

  // Exactly one completion record for the completed chore. `choreId` is unique,
  // so it is the natural key. `completedAt` defaults to now() on first insert and
  // the empty `update` never touches it.
  await prisma.completionRecord.upsert({
    where: { choreId: "demo-chore-completed" },
    create: { choreId: "demo-chore-completed", userId: member.id },
    update: { userId: member.id },
  });

  // Exactly one skip record (non-empty reason) for the skipped chore.
  await prisma.skipRecord.upsert({
    where: { choreId: "demo-chore-skipped" },
    create: {
      choreId: "demo-chore-skipped",
      userId: admin.id,
      reason: "Rain all week — moved to next weekend.",
    },
    update: {
      userId: admin.id,
      reason: "Rain all week — moved to next weekend.",
    },
  });

  console.log("Seed complete:", {
    households: await prisma.household.count(),
    users: await prisma.user.count(),
    memberships: await prisma.membership.count(),
    categories: await prisma.category.count(),
    chores: await prisma.chore.count(),
    choreAssignees: await prisma.choreAssignee.count(),
    completionRecords: await prisma.completionRecord.count(),
    skipRecords: await prisma.skipRecord.count(),
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
