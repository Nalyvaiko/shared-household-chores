// The chore form's state and field readers, shared by the create and edit
// actions and the form. A plain module: a "use server" module may only
// export async functions.

/** What the user entered, echoed back so the form keeps it after a refusal. */
export type ChoreFormValues = {
  title: string;
  dueAtLocal: string;
  priority: string;
  effort: string;
  categoryId: string;
  recurrence: string;
  assignmentMode: string;
  /** User ids of the ticked members. Always empty in Claim mode. */
  assigneeIds: string[];
};

export type ChoreFormErrors = {
  title?: string[];
  dueAt?: string[];
  priority?: string[];
  effort?: string[];
  categoryId?: string[];
  recurrence?: string[];
  assignmentMode?: string[];
  assigneeIds?: string[];
};

export type ChoreFormState = {
  values: ChoreFormValues;
  errors?: ChoreFormErrors;
  /** A refusal of the whole form: the chore is gone or no longer pending. */
  formError?: string;
};

/** A posted field's value; a missing or non-string value counts as empty. */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Every submitted assignee id, once each. A non-string value counts as empty. */
export function assigneeIdsField(formData: FormData): string[] {
  const ids = formData
    .getAll("assigneeIds")
    .map((value) => (typeof value === "string" ? value : ""));
  return [...new Set(ids)];
}
