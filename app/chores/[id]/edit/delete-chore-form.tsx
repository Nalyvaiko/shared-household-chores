"use client";

import { useActionState } from "react";

import { deleteChore, type DeleteChoreState } from "@/app/chores/[id]/edit/actions";
import { DELETE_RECURRING_NOTE, deleteChoreQuestion } from "@/app/chores/[id]/edit/messages";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The admin's delete control: an inline disclosure (the Skip pattern), so it
 * works without JavaScript. Closing it again is the cancel.
 */
export function DeleteChoreForm({
  choreId,
  title,
  recurring,
}: {
  choreId: string;
  title: string;
  /** A pending recurring chore: deleting it also ends the series. */
  recurring: boolean;
}) {
  const [state, action, pending] = useActionState<DeleteChoreState, FormData>(deleteChore, {});

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <details>
        <summary
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          )}
        >
          Delete chore
        </summary>
        <form action={action} className="mt-2 flex flex-col items-start gap-2">
          <input type="hidden" name="choreId" value={choreId} />
          <p className="text-sm break-words">{deleteChoreQuestion(title)}</p>
          {recurring ? <p className="text-sm text-muted-foreground">{DELETE_RECURRING_NOTE}</p> : null}
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            {pending ? "Deleting…" : "Delete chore"}
          </Button>
        </form>
      </details>
      <div role="alert">
        {state.error ? (
          <p className="rounded-md border border-destructive px-4 py-3 text-sm break-words text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
