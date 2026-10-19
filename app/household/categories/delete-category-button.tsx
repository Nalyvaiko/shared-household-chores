"use client";

import { useActionState, useState } from "react";

import {
  deleteCategory,
  type DeleteCategoryState,
} from "@/app/household/categories/actions";
import { Button } from "@/components/ui/button";

const initialState: DeleteCategoryState = {};

type DeleteCategoryButtonProps = {
  categoryId: string;
  name: string;
};

/** "Delete", then an inline confirm step before the Server Action runs. */
export function DeleteCategoryButton({ categoryId, name }: DeleteCategoryButtonProps) {
  const [state, action, pending] = useActionState(deleteCategory, initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      {confirming ? (
        <form
          action={action}
          className="flex min-w-0 flex-col items-end gap-2"
          role="group"
          aria-label={`Confirm deleting ${name}`}
        >
          <input type="hidden" name="categoryId" value={categoryId} />
          <p className="text-right text-sm break-words">
            Delete {name}? Chores in this category will have no category.
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      )}
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
