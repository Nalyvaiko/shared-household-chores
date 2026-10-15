import { compare } from "bcryptjs";

import { db } from "@/lib/db";
import {
  normalizeEmail,
  PASSWORD_MAX_BYTES,
  utf8ByteLength,
} from "@/lib/auth/validation";

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * The Credentials provider's `authorize`: returns the user for a correct
 * email + password pair, and `null` (never a thrown error) otherwise.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>> | undefined,
): Promise<AuthorizedUser | null> {
  const email = credentials?.email;
  const password = credentials?.password;
  if (typeof email !== "string" || typeof password !== "string") return null;
  if (email.length === 0 || password.length === 0) return null;
  // bcrypt compares only the first 72 bytes, so a longer password would match
  // the stored hash of its own 72-byte prefix. Reject it before comparing.
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) return null;

  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!user) return null;

  const valid = await compare(password, user.passwordHash);
  if (!valid) return null;

  return { id: user.id, email: user.email, name: user.name };
}
