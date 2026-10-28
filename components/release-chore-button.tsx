"use client";

import { useFormStatus } from "react-dom";

import { useChoreFeedback } from "@/components/chore-feedback";
import { Button } from "@/components/ui/button";

function SubmitButton({ title }: { title: string }) {
  // Pending only for this row's form, even though the action is shared.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Releasing…" : "Release"}
      <span className="sr-only"> &quot;{title}&quot;</span>
    </Button>
  );
}

/** One click gives up the viewer's claim; there is no confirm step. */
export function ReleaseChoreButton({ choreId, title }: { choreId: string; title: string }) {
  const { releaseAction } = useChoreFeedback();
  return (
    <form action={releaseAction}>
      <input type="hidden" name="choreId" value={choreId} />
      <SubmitButton title={title} />
    </form>
  );
}
