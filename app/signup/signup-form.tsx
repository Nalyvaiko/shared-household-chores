"use client";

import { useActionState } from "react";

import { signup, type SignupState } from "@/app/signup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignupState = { email: "" };

function FieldErrors({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <div id={id} className="text-sm text-destructive" role="alert">
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}

export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState(signup, initialState);
  const emailErrors = state.errors?.email;
  const passwordErrors = state.errors?.password;

  return (
    <form action={action} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={emailErrors ? true : undefined}
          aria-describedby={emailErrors ? "email-error" : undefined}
        />
        <FieldErrors id="email-error" errors={emailErrors} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={passwordErrors ? true : undefined}
          aria-describedby={passwordErrors ? "password-error" : "password-hint"}
        />
        {passwordErrors ? (
          <FieldErrors id="password-error" errors={passwordErrors} />
        ) : (
          <p id="password-hint" className="text-sm text-muted-foreground">
            At least 8 characters.
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
