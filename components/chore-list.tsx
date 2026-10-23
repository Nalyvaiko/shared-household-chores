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
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <div>
          <dt className="sr-only">Category</dt>
          <dd className="break-words">{chore.category?.name ?? "No category"}</dd>
        </div>
        <div>
          <dt className="sr-only">Due</dt>
          <dd>
            {chore.dueAt ? <LocalDateTime iso={chore.dueAt.toISOString()} /> : "No due date"}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Priority</dt>
          <dd>Priority: {priorityLabel(chore.priority)}</dd>
        </div>
        <div>
          <dt className="sr-only">Effort</dt>
          <dd>Effort: {effortLabel(chore.effort)}</dd>
        </div>
        {repeats ? (
          <div>
            <dt className="sr-only">Recurrence</dt>
            <dd>{repeats}</dd>
          </div>
        ) : null}
        <div>
          <dt className="sr-only">Assignees</dt>
          <dd className="break-words">{assigneeLine(chore, viewerId)}</dd>
        </div>
      </dl>
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
