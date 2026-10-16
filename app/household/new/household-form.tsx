"use client";

import { useActionState } from "react";

import {
  createHousehold,
  type CreateHouseholdState,
} from "@/app/household/new/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: CreateHouseholdState = { name: "" };

export function HouseholdForm() {
  const [state, action, pending] = useActionState(createHousehold, initialState);
  const nameErrors = state.errors?.name;

  return (
    <form action={action} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Household name</Label>
        {/* No maxLength: the browser counts UTF-16 units; the server checks the limit. */}
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="off"
          required
          defaultValue={state.name}
          aria-invalid={nameErrors ? true : undefined}
          aria-describedby={nameErrors ? "name-error" : undefined}
        />
        {nameErrors?.length ? (
          <div id="name-error" className="text-sm text-destructive" role="alert">
            {nameErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create household"}
      </Button>
    </form>
  );
}
