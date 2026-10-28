"use client";

import { useFormStatus } from "react-dom";

import { useChoreFeedback } from "@/components/chore-feedback";
import { Button } from "@/components/ui/button";

function SubmitButton({ title }: { title: string }) {
  // Pending only for this row's form, even though the action is shared.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Claiming…" : "Claim"}
      <span className="sr-only"> &quot;{title}&quot;</span>
    </Button>
  );
}

/** One click claims the chore for the viewer; there is no confirm step. */
export function ClaimChoreButton({ choreId, title }: { choreId: string; title: string }) {
  const { claimAction } = useChoreFeedback();
  return (
    <form action={claimAction}>
      <input type="hidden" name="choreId" value={choreId} />
      <SubmitButton title={title} />
    </form>
  );
}
