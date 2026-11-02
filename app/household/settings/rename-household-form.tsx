"use client";

import { useActionState } from "react";

import {
  renameHousehold,
  type RenameHouseholdState,
} from "@/app/household/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RenameHouseholdFormProps = {
  /** The household's name when the page was rendered. */
  currentName: string;
};

export function RenameHouseholdForm({ currentName }: RenameHouseholdFormProps) {
  const [state, action, pending] = useActionState<RenameHouseholdState, FormData>(
    renameHousehold,
    { name: currentName },
  );

  // React resets the form after the action; `defaultValue` then puts back what
  // was typed on a refusal, or the saved name after a success.
  return (
    <form action={action} noValidate className="flex w-full max-w-sm flex-col gap-2">
      <Label htmlFor="household-name">Household name</Label>
      <div className="flex gap-2">
        {/* No maxLength: the browser counts UTF-16 units; the server checks the limit. */}
        <Input
          id="household-name"
          name="name"
          type="text"
          autoComplete="off"
          required
          defaultValue={state.name}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "household-name-error" : undefined}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state.error ? (
        <p id="household-name-error" className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-muted-foreground" role="status">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
