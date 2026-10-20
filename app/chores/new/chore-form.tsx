"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createChore,
  type ChoreFormValues,
  type CreateChoreState,
} from "@/app/chores/new/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localToUtcIso } from "@/lib/chore/due-date";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: string; name: string };

const initialValues: ChoreFormValues = {
  title: "",
  dueAtLocal: "",
  priority: "medium",
  effort: "medium",
  categoryId: "",
};

const initialState: CreateChoreState = { values: initialValues };

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

/** Keeps the hidden UTC field in step with the visible local one. */
function syncHiddenDueAt(local: HTMLInputElement | null, utc: HTMLInputElement | null) {
  if (!local || !utc) return;
  utc.value = localToUtcIso(local.value, local.validity.badInput);
}

export function ChoreForm({ categories }: { categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState(createChore, initialState);
  const { values, errors } = state;
  const localRef = useRef<HTMLInputElement>(null);
  const utcRef = useRef<HTMLInputElement>(null);

  const syncDueAt = () => syncHiddenDueAt(localRef.current, utcRef.current);

  // On mount (a date typed before hydration is converted too) and after every
  // action result: React resets the form to the echoed values then, and the
  // echoed local time needs its UTC value again so a resubmit without touching
  // the date saves the same instant.
  useEffect(() => {
    syncHiddenDueAt(localRef.current, utcRef.current);
  }, [state]);

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
        <input ref={utcRef} type="hidden" name="dueAt" defaultValue="" />
        <FieldErrors id="dueAt-error" errors={errors?.dueAt} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="priority">Priority</Label>
        <select
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

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating…" : "Create chore"}
      </Button>
    </form>
  );
}
