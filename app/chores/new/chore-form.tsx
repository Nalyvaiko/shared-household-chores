"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { noScriptDueText } from "@/app/chores/[id]/edit/messages";
import { createChore } from "@/app/chores/new/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nativeSelectClassName } from "@/components/ui/native-select";
import {
  DUE_AT_LOCAL_MAX,
  DUE_AT_LOCAL_MIN,
  DUE_AT_UNCHANGED_MARKER,
  localToUtcIso,
  utcIsoToLocal,
} from "@/lib/chore/due-date";
import type { ChoreFormState, ChoreFormValues } from "@/lib/chore/form";
import {
  ASSIGNMENT_MODE_OPTIONS,
  EFFORT_OPTIONS,
  PRIORITY_OPTIONS,
  RECURRENCE_OPTIONS,
} from "@/lib/chore/labels";
import { formatUtcDateTime } from "@/lib/date-time-format";

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

type ChoreFormAction = (state: ChoreFormState, formData: FormData) => Promise<ChoreFormState>;

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

export function ChoreForm({
  categories,
  members,
  values: initialValues = NEW_CHORE_VALUES,
  action: submitAction = createChore,
  submitLabel = "Create chore",
  pendingLabel = "Creating…",
  choreId,
  cancelHref,
  storedDueAt,
  assignmentReadOnly,
}: {
  categories: CategoryOption[];
  members: MemberOption[];
  /** The values the form starts with. */
  values?: ChoreFormValues;
  /** The Server Action the form posts to; creates a chore by default. */
  action?: ChoreFormAction;
  submitLabel?: string;
  pendingLabel?: string;
  /** Posted in a hidden `choreId` field when editing. */
  choreId?: string;
  /** A "Cancel" link next to the submit button. */
  cancelHref?: string;
  /**
   * Set when editing: the chore's stored due date as an ISO string, or null
   * for none. The field is filled in the browser's zone after hydration.
   */
  storedDueAt?: string | null;
  /**
   * Set for an editor who may not change the assignment: the mode label and
   * the assignee line shown instead of the radios and the member list.
   */
  assignmentReadOnly?: { modeLabel: string; assigneeLine: string; note: string };
}) {
  const [state, action, pending] = useActionState<ChoreFormState, FormData>(submitAction, {
    values: initialValues,
  });
  const { values, errors } = state;
  const editing = storedDueAt !== undefined;

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
  //
  // When editing, the server and the first client render can't know the
  // viewer's zone, so they send the `unchanged` marker with an empty visible
  // field, and hydration always matches.
  const [dueAtUtc, setDueAtUtc] = useState(editing ? DUE_AT_UNCHANGED_MARKER : "");
  // The local string the stored due date was filled in as, once hydrated.
  const prefilledRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  // While the visible value is still the filled-in one, the stored ISO string
  // is sent exactly, not recomputed, so a DST fall-back hour can't shift an
  // untouched date.
  const syncDueAt = () => {
    const local = localRef.current;
    if (!local) return;
    const untouched =
      storedDueAt != null &&
      prefilledRef.current !== null &&
      !local.validity.badInput &&
      local.value === prefilledRef.current;
    setDueAtUtc(untouched ? storedDueAt : localToUtcIso(local.value, local.validity.badInput));
  };

  // On mount (a date typed before hydration is converted too) and after every
  // action result: React resets the form to the echoed values then, and the
  // echoed local time needs its UTC value again so a resubmit without touching
  // the date saves the same instant. Only the mount fills in a stored due date,
  // and only into an empty field, so it never overwrites a typed or echoed one.
  useEffect(() => {
    const local = localRef.current;
    if (!local) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (storedDueAt) {
        prefilledRef.current = utcIsoToLocal(storedDueAt);
        if (local.value === "" && !local.validity.badInput) local.value = prefilledRef.current;
      }
    }
    syncDueAt();
    // syncDueAt reads only refs and props listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, storedDueAt]);

  // React ignores a <select>'s defaultValue after mount, so the form reset that
  // follows each action would put the selects back to their first defaults.
  // Each select is keyed on its echoed value: it remounts with the new default
  // whenever that value changes, and otherwise its default already matches.
  return (
    <form action={action} noValidate className="flex w-full max-w-md flex-col gap-5">
      {choreId !== undefined ? <input type="hidden" name="choreId" value={choreId} /> : null}
      {state.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive px-4 py-3 text-sm break-words text-destructive"
        >
          {state.formError}
        </p>
      ) : null}
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
        {storedDueAt ? (
          <noscript>
            <p className="text-sm text-muted-foreground">
              {noScriptDueText(formatUtcDateTime(new Date(storedDueAt)))}
            </p>
          </noscript>
        ) : null}
        <FieldErrors id="dueAt-error" errors={errors?.dueAt} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="recurrence">Repeats</Label>
        <select
          key={values.recurrence}
          id="recurrence"
          name="recurrence"
          className={nativeSelectClassName}
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
          className={nativeSelectClassName}
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
          className={nativeSelectClassName}
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
          className={nativeSelectClassName}
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

      {assignmentReadOnly ? (
        // No radios or list, so nothing about the assignment is posted.
        <div className="flex flex-col gap-2 text-sm">
          <h2 className="mb-2 leading-none font-medium">Assignment</h2>
          <p>{assignmentReadOnly.modeLabel}</p>
          <p className="break-words">{assignmentReadOnly.assigneeLine}</p>
          <p className="text-muted-foreground">{assignmentReadOnly.note}</p>
        </div>
      ) : (
        <>
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
        </>
      )}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {cancelHref ? (
          <Link href={cancelHref} className="text-sm underline underline-offset-4">
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
