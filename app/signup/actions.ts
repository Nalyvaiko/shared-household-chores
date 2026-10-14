"use server";

import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";

import { signIn } from "@/auth";
import {
  BCRYPT_COST,
  EMAIL_TAKEN_ERROR,
  signupSchema,
} from "@/lib/auth/validation";
import { db } from "@/lib/db";

export type SignupState = {
  /** What the visitor typed, so the form can keep it. Never the password. */
  email: string;
  errors?: {
    email?: string[];
    password?: string[];
  };
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isUniqueEmailViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = error.meta?.target;
  if (target === undefined) return true; // `email` is User's only unique field
  return Array.isArray(target)
    ? target.includes("email")
    : String(target).includes("email");
}

export async function signup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const enteredEmail = field(formData, "email");
  const parsed = signupSchema.safeParse({
    email: enteredEmail,
    password: field(formData, "password"),
  });

  if (!parsed.success) {
    const { fieldErrors } = parsed.error.flatten();
    return {
      email: enteredEmail,
      errors: { email: fieldErrors.email, password: fieldErrors.password },
    };
  }

  const { email, password } = parsed.data;
  const emailTaken = { email: enteredEmail, errors: { email: [EMAIL_TAKEN_ERROR] } };

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return emailTaken;

  const passwordHash = await hash(password, BCRYPT_COST);

  try {
    await db.user.create({ data: { email, passwordHash } });
  } catch (error) {
    // Lost a race with a concurrent signup for the same email.
    if (isUniqueEmailViolation(error)) return emailTaken;
    throw error;
  }

  // Throws a redirect on success, so it must stay outside any try/catch.
  await signIn("credentials", { email, password, redirectTo: "/" });
  return { email: enteredEmail };
}
