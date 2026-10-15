import * as z from "zod";

// bcrypt only hashes the first 72 bytes of its input, so anything longer would
// be silently truncated. The limits are in UTF-8 bytes, not characters.
export const PASSWORD_MIN_BYTES = 8;
export const PASSWORD_MAX_BYTES = 72;

export const BCRYPT_COST = 12;

export const EMAIL_ERROR = "Enter a valid email address.";
export const PASSWORD_TOO_SHORT_ERROR = `Password must be at least ${PASSWORD_MIN_BYTES} characters.`;
export const PASSWORD_TOO_LONG_ERROR = `Password is too long: use at most ${PASSWORD_MAX_BYTES} bytes (accented letters and emoji count as more than one).`;
export const EMAIL_TAKEN_ERROR = "An account with this email already exists.";

/** Trim and lower-case an email so differently typed addresses match. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const signupSchema = z.object({
  email: z
    .string({ error: EMAIL_ERROR })
    .overwrite(normalizeEmail)
    .pipe(z.email({ error: EMAIL_ERROR })),
  // The password is deliberately not trimmed or otherwise altered.
  password: z
    .string({ error: PASSWORD_TOO_SHORT_ERROR })
    .refine((p) => utf8ByteLength(p) >= PASSWORD_MIN_BYTES, {
      error: PASSWORD_TOO_SHORT_ERROR,
      abort: true,
    })
    .refine((p) => utf8ByteLength(p) <= PASSWORD_MAX_BYTES, {
      error: PASSWORD_TOO_LONG_ERROR,
    }),
});

export type SignupInput = z.infer<typeof signupSchema>;

/** The one message for every failed sign-in, so it never says which field was wrong. */
export const INVALID_CREDENTIALS_ERROR = "Invalid email or password.";
