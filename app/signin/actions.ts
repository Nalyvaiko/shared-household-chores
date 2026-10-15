"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { INVALID_CREDENTIALS_ERROR, normalizeEmail } from "@/lib/auth/validation";

export type SigninState = {
  /** What the visitor typed, so the form can keep it. Never the password. */
  email: string;
  error?: string;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signin(
  _prev: SigninState,
  formData: FormData,
): Promise<SigninState> {
  const enteredEmail = field(formData, "email");
  // The password is deliberately not trimmed or otherwise altered.
  const password = field(formData, "password");
  // The hidden field comes from the client, so it is checked again here.
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"));
  const invalid = { email: enteredEmail, error: INVALID_CREDENTIALS_ERROR };

  const email = normalizeEmail(enteredEmail);
  if (email.length === 0 || password.length === 0) return invalid;

  try {
    // Throws a redirect (NEXT_REDIRECT) on success.
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError && error.type === "CredentialsSignin") {
      return invalid;
    }
    // The success redirect and unexpected failures (database down, ...).
    throw error;
  }
  return { email: enteredEmail };
}
