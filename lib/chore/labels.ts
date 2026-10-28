import type {
  AssignmentMode,
  ChoreStatus,
  Effort,
  Priority,
  RecurrenceFrequency,
} from "@prisma/client";

// Display labels for the chore enums, shared by the new-chore form and the
// chore list so both always read the same.

type Option<T extends string> = { value: T; label: string };

export const PRIORITY_OPTIONS: readonly Option<Priority>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const EFFORT_OPTIONS: readonly Option<Effort>[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

export const RECURRENCE_OPTIONS: readonly Option<RecurrenceFrequency>[] = [
  { value: "none", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export const ASSIGNMENT_MODE_OPTIONS: readonly Option<AssignmentMode>[] = [
  { value: "fixed", label: "Fixed — specific people" },
  { value: "claim", label: "Claim — anyone can claim it" },
];

export const STATUS_OPTIONS: readonly Option<ChoreStatus>[] = [
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "skipped", label: "Skipped" },
];

function labelOf<T extends string>(options: readonly Option<T>[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function priorityLabel(value: Priority): string {
  return labelOf(PRIORITY_OPTIONS, value);
}

export function effortLabel(value: Effort): string {
  return labelOf(EFFORT_OPTIONS, value);
}

export function assignmentModeLabel(value: AssignmentMode): string {
  return labelOf(ASSIGNMENT_MODE_OPTIONS, value);
}

export function statusLabel(value: ChoreStatus): string {
  return labelOf(STATUS_OPTIONS, value);
}

/** "Repeats daily" and so on, or null for a one-off chore. */
export function recurrenceLabel(value: RecurrenceFrequency): string | null {
  return value === "none" ? null : `Repeats ${labelOf(RECURRENCE_OPTIONS, value).toLowerCase()}`;
}
