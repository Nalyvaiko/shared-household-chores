import type { ReactNode } from "react";

import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { effortLabel, priorityLabel, recurrenceLabel, statusLabel } from "@/lib/chore/labels";
import { assigneeLine, isOverdue, type ChoreListItem } from "@/lib/chore/list";

const STATUS_BADGE_VARIANT = {
  pending: "secondary",
  completed: "default",
  skipped: "outline",
} as const;

/**
 * One chore in a list. Everything is shown as text, never colour alone.
 * `actions` is rendered inside the row for the controls later tasks add.
 */
export function ChoreRow({
  chore,
  viewerId,
  now,
  actions,
}: {
  chore: ChoreListItem;
  viewerId: string;
  /** The request's single "now", shared with the overdue filter. */
  now: Date;
  actions?: ReactNode;
}) {
  const repeats = recurrenceLabel(chore.recurrence);

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 font-medium break-words">{chore.title}</span>
        <span className="flex flex-wrap gap-1">
          <Badge variant={STATUS_BADGE_VARIANT[chore.status]}>{statusLabel(chore.status)}</Badge>
          {isOverdue(chore, now) ? <Badge variant="destructive">Overdue</Badge> : null}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="min-w-0 break-words">
          {chore.category ? (
            <>
              <span className="sr-only">Category: </span>
              {chore.category.name}
            </>
          ) : (
            "No category"
          )}
        </span>
        <span>
          {chore.dueAt ? (
            <>
              <span className="sr-only">Due: </span>
              <LocalDateTime iso={chore.dueAt.toISOString()} />
            </>
          ) : (
            "No due date"
          )}
        </span>
        <span>Priority: {priorityLabel(chore.priority)}</span>
        <span>Effort: {effortLabel(chore.effort)}</span>
        {repeats ? <span>{repeats}</span> : null}
        <span className="min-w-0 break-words">{assigneeLine(chore, viewerId)}</span>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}

/** The chores as a `<ul>`, in the order given. */
export function ChoreList({
  chores,
  viewerId,
  now,
  actions,
}: {
  chores: readonly ChoreListItem[];
  viewerId: string;
  now: Date;
  /** Controls for one chore's row, if any. */
  actions?: (chore: ChoreListItem) => ReactNode;
}) {
  return (
    <ul className="flex w-full flex-col divide-y rounded-md border">
      {chores.map((chore) => (
        <ChoreRow
          key={chore.id}
          chore={chore}
          viewerId={viewerId}
          now={now}
          actions={actions?.(chore)}
        />
      ))}
    </ul>
  );
}
