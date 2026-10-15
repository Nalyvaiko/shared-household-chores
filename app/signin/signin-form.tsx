"use client";

import { useActionState } from "react";

import { signin, type SigninState } from "@/app/signin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SigninState = { email: "" };

export function SigninForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState(signin, initialState);
  const error = state.error;

  return (
    <form action={action} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {error ? (
        <p id="signin-error" className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signin-error" : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signin-error" : undefined}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
