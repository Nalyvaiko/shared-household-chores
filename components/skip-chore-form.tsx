"use client";

import { useFormStatus } from "react-dom";

import { useChoreFeedback } from "@/components/chore-feedback";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// The look of `components/ui/input.tsx`, on a native, multi-line textarea.
const textareaClassName = cn(
  "min-h-16 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
);

export const RECURRING_SKIP_NOTE =
  "This chore repeats. Skipping it ends the series: no next occurrence will be created.";

function SubmitButton({ title }: { title: string }) {
  // Pending only for this row's form, even though the action is shared.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? "Skipping…" : "Skip chore"}
      <span className="sr-only"> &quot;{title}&quot;</span>
    </Button>
  );
}

/**
 * An inline disclosure (no dialog) so Skip works without JavaScript. Opening
 * it moves no focus; pressing the summary again closes it.
 */
export function SkipChoreForm({
  choreId,
  title,
  recurring,
}: {
  choreId: string;
  title: string;
  recurring: boolean;
}) {
  const { skipAction, skipDraft } = useChoreFeedback();
  // After a refused reason, only that row reopens with the text as submitted.
  // React resets the form after an action, so the remount (a new key) is what
  // applies `open` and `defaultValue` again.
  const draft = skipDraft?.choreId === choreId ? skipDraft : null;
  const reasonId = `skip-reason-${choreId}`;

  return (
    <details
      key={draft ? `draft-${draft.key}` : "closed"}
      open={draft ? true : undefined}
      className="open:basis-full"
    >
      <summary
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        Skip<span className="sr-only"> &quot;{title}&quot;</span>
      </summary>
      <form action={skipAction} className="mt-2 flex max-w-md flex-col gap-2">
        <input type="hidden" name="choreId" value={choreId} />
        <Label htmlFor={reasonId}>Reason for skipping</Label>
        <textarea
          id={reasonId}
          name="reason"
          required
          rows={2}
          defaultValue={draft?.reason}
          className={textareaClassName}
        />
        {recurring ? <p className="text-sm text-muted-foreground">{RECURRING_SKIP_NOTE}</p> : null}
        <div>
          <SubmitButton title={title} />
        </div>
      </form>
    </details>
  );
}
