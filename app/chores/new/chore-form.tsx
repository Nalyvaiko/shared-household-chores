"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createChore,
  type ChoreFormValues,
  type CreateChoreState,
} from "@/app/chores/new/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DUE_AT_LOCAL_MAX, DUE_AT_LOCAL_MIN, localToUtcIso } from "@/lib/chore/due-date";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: string; name: string };

/** A current household member, in the members page order. */
export type MemberOption = {
  userId: string;
  name: string | null;
  email: string;
  /** The caller, marked "(you)". */
  isSelf: boolean;
};

const NEW_CHORE_VALUES: ChoreFormValues = {
  title: "",
  dueAtLocal: "",
  priority: "medium",
  effort: "medium",
  categoryId: "",
  recurrence: "none",
  assignmentMode: "fixed",
  assigneeIds: [],
};

const RECURRENCE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const ASSIGNMENT_MODE_OPTIONS = [
  { value: "fixed", label: "Fixed — specific people" },
  { value: "claim", label: "Claim — anyone can claim it" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const EFFORT_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

// A native select styled like the shadcn Input.
const selectClassName = cn(
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
);

function FieldErrors({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <div id={id} className="text-sm text-destructive" role="alert">
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}

function invalidProps(id: string, errors?: string[]) {
  return errors?.length
    ? { "aria-invalid": true as const, "aria-describedby": id }
    : {};
}

/** The UTC value for the visible local field, or null before it mounts. */
function utcFor(local: HTMLInputElement | null): string | null {
  return local ? localToUtcIso(local.value, local.validity.badInput) : null;
}

export function ChoreForm({
  categories,
  members,
  values: initialValues = NEW_CHORE_VALUES,
}: {
  categories: CategoryOption[];
  members: MemberOption[];
  /** The values the form starts with. */
  values?: ChoreFormValues;
}) {
  const [state, action, pending] = useActionState<CreateChoreState, FormData>(createChore, {
    values: initialValues,
  });
  const { values, errors } = state;

  // The picked mode checks its radio and decides whether the member list
  // shows. After each action result it follows the echoed mode.
  const [mode, setMode] = useState(values.assignmentMode);
  const [modeState, setModeState] = useState(state);
  if (modeState !== state) {
    setModeState(state);
    setMode(state.values.assignmentMode);
  }
  const localRef = useRef<HTMLInputElement>(null);

  // The hidden UTC field is controlled by this state. A hidden input's value is
  // its `value` attribute, so with `defaultValue=""` every re-render (a mode or
  // tick change) would write "" back over a value set on the DOM node.
  const [dueAtUtc, setDueAtUtc] = useState("");
  const syncDueAt = () => {
    const utc = utcFor(localRef.current);
    if (utc !== null) setDueAtUtc(utc);
  };

  // On mount (a date typed before hydration is converted too) and after every
  // action result: React resets the form to the echoed values then, and the
  // echoed local time needs its UTC value again so a resubmit without touching
  // the date saves the same instant.
  useEffect(() => {
    const utc = utcFor(localRef.current);
    if (utc !== null) setDueAtUtc(utc);
  }, [state]);

  // React ignores a <select>'s defaultValue after mount, so the form reset that
  // follows each action would put the selects back to their first defaults.
  // Each select is keyed on its echoed value: it remounts with the new default
  // whenever that value changes, and otherwise its default already matches.
  return (
    <form action={action} noValidate className="flex w-full max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Title</Label>
        {/* No maxLength: the browser counts UTF-16 units; the server checks the limit. */}
        <Input
          id="title"
          name="title"
          type="text"
          autoComplete="off"
          required
          defaultValue={values.title}
          {...invalidProps("title-error", errors?.title)}
        />
        <FieldErrors id="title-error" errors={errors?.title} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="dueAtLocal">Due (optional)</Label>
        <Input
          ref={localRef}
          id="dueAtLocal"
          name="dueAtLocal"
          type="datetime-local"
          min={DUE_AT_LOCAL_MIN}
          max={DUE_AT_LOCAL_MAX}
          defaultValue={values.dueAtLocal}
          onChange={syncDueAt}
          // Typing only part of a date leaves the value "" and fires no change
          // event, yet sets validity.badInput; these catch that case before
          // the submit click or Enter.
          onKeyUp={syncDueAt}
          onBlur={syncDueAt}
          {...invalidProps("dueAt-error", errors?.dueAt)}
        />
        {/* The UTC instant the local time means in this browser's zone. */}
        <input type="hidden" name="dueAt" value={dueAtUtc} />
        <FieldErrors id="dueAt-error" errors={errors?.dueAt} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="recurrence">Repeats</Label>
        <select
          key={values.recurrence}
          id="recurrence"
          name="recurrence"
          className={selectClassName}
          defaultValue={values.recurrence}
          {...invalidProps("recurrence-error", errors?.recurrence)}
        >
          {RECURRENCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldErrors id="recurrence-error" errors={errors?.recurrence} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="priority">Priority</Label>
        <select
          key={values.priority}
          id="priority"
          name="priority"
          className={selectClassName}
          defaultValue={values.priority}
          {...invalidProps("priority-error", errors?.priority)}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldErrors id="priority-error" errors={errors?.priority} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="effort">Effort</Label>
        <select
          key={values.effort}
          id="effort"
          name="effort"
          className={selectClassName}
          defaultValue={values.effort}
          {...invalidProps("effort-error", errors?.effort)}
        >
          {EFFORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldErrors id="effort-error" errors={errors?.effort} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="categoryId">Category</Label>
        <select
          key={values.categoryId}
          id="categoryId"
          name="categoryId"
          className={selectClassName}
          defaultValue={values.categoryId}
          {...invalidProps("categoryId-error", errors?.categoryId)}
        >
          <option value="">None</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <FieldErrors id="categoryId-error" errors={errors?.categoryId} />
      </div>

      <fieldset
        className="flex flex-col gap-2"
        {...invalidProps("assignmentMode-error", errors?.assignmentMode)}
      >
        <legend className="mb-2 text-sm leading-none font-medium">Assignment</legend>
        {/* Controlled: on every render React re-sets an uncontrolled radio's
            `checked` attribute, which re-checks the default radio the user
            moved away from. Keyed on the echoed mode, like the selects, so
            the form reset puts back the echoed mode (the one checked when the
            radios mounted). */}
        <div key={values.assignmentMode} className="flex flex-col gap-2">
          {ASSIGNMENT_MODE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="assignmentMode"
                value={option.value}
                checked={mode === option.value}
                onChange={(event) => setMode(event.target.value)}
                className="size-4 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
        <FieldErrors id="assignmentMode-error" errors={errors?.assignmentMode} />
      </fieldset>

      {/* Hidden, not removed, in Claim mode, so the ticks come back with
          Fixed. Without JavaScript it stays visible; the server ignores it. */}
      <fieldset
        id="assignees"
        hidden={mode === "claim"}
        className="flex flex-col gap-2"
        {...invalidProps("assigneeIds-error", errors?.assigneeIds)}
      >
        <legend className="mb-2 text-sm leading-none font-medium">Assigned to</legend>
        {/* Keyed on the echoed ticks, so the form reset can't revert them. */}
        <ul key={values.assigneeIds.join(" ")} className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.userId}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="assigneeIds"
                  value={member.userId}
                  defaultChecked={values.assigneeIds.includes(member.userId)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="break-words">
                    {member.name || member.email}
                    {member.isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                  </span>
                  {member.name ? (
                    <span className="break-all text-muted-foreground">{member.email}</span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <FieldErrors id="assigneeIds-error" errors={errors?.assigneeIds} />
      </fieldset>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating…" : "Create chore"}
      </Button>
    </form>
  );
}
