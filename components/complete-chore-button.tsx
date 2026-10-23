"use client";

import { useFormStatus } from "react-dom";

import { useChoreFeedback } from "@/components/chore-feedback";
import { Button } from "@/components/ui/button";

function SubmitButton({ title }: { title: string }) {
  // Pending only for this row's form, even though the action is shared.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Completing…" : "Complete"}
      <span className="sr-only"> &quot;{title}&quot;</span>
    </Button>
  );
}

/** One click completes the chore; there is no confirm step. */
export function CompleteChoreButton({ choreId, title }: { choreId: string; title: string }) {
  const { completeAction } = useChoreFeedback();
  return (
    <form action={completeAction}>
      <input type="hidden" name="choreId" value={choreId} />
      <SubmitButton title={title} />
    </form>
  );
}
