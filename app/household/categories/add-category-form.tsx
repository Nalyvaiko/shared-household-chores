"use client";

import { useActionState } from "react";

import { addCategory, type AddCategoryState } from "@/app/household/categories/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AddCategoryState = { name: "" };

export function AddCategoryForm() {
  const [state, action, pending] = useActionState(addCategory, initialState);

  // React resets the form after the action; `defaultValue` then puts back what
  // was typed on a refusal, or leaves it empty after a success.
  return (
    <form action={action} noValidate className="flex w-full max-w-sm flex-col gap-2">
      <Label htmlFor="category-name">Category name</Label>
      <div className="flex gap-2">
        {/* No maxLength: the browser counts UTF-16 units; the server checks the limit. */}
        <Input
          id="category-name"
          name="name"
          type="text"
          autoComplete="off"
          required
          defaultValue={state.name}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "category-name-error" : undefined}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add category"}
        </Button>
      </div>
      {state.error ? (
        <p id="category-name-error" className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
