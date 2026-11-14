import { afterAll, beforeEach, vi } from "vitest";

import { resetDatabase } from "./helpers";
import { currentSession } from "./session";

// Only what has no server in a test is mocked; everything else, including
// Prisma and the database, is real.

// `server-only` throws outside a React Server Components build.
vi.mock("server-only", () => ({}));

// The session: whoever `asUser()` names for the current async call chain.
vi.mock("@/auth", () => ({
  auth: async () => currentSession(),
  signIn: async () => undefined,
  signOut: async () => undefined,
  handlers: {},
}));

// `redirect()` throws, as it does in Next.js; the target is in the message.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

// Nothing to revalidate without a Next.js server.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});
