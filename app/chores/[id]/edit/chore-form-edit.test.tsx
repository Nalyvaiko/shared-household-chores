import { act, type ComponentProps } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChoreFormState } from "@/lib/chore/form";
import { localToUtcIso, utcIsoToLocal } from "@/lib/chore/due-date";
import { formatUtcDateTime } from "@/lib/date-time-format";

// The form's default action; edit passes its own.
vi.mock("@/app/chores/new/actions", () => ({ createChore: vi.fn() }));

const { ChoreForm } = await import("@/app/chores/new/chore-form");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const updateChore = vi.fn<(prev: ChoreFormState, formData: FormData) => Promise<ChoreFormState>>();

// Seconds and milliseconds, so a recomputed value would differ from it.
const STORED = "2026-11-01T09:30:45.123Z";

const members = [
  { userId: "user_1", name: "Alice", email: "alice@example.com", isSelf: true },
  { userId: "user_2", name: "Bob", email: "bob@example.com", isSelf: false },
];

const values = {
  title: "Take out bins",
  dueAtLocal: "",
  priority: "high",
  effort: "large",
  categoryId: "cat_kitchen",
  recurrence: "weekly",
  assignmentMode: "fixed",
  assigneeIds: ["user_2"],
};

type Props = ComponentProps<typeof ChoreForm>;

function editForm(overrides: Partial<Props> = {}) {
  return (
    <ChoreForm
      categories={[{ id: "cat_kitchen", name: "Kitchen" }]}
      members={members}
      values={values}
      action={updateChore}
      submitLabel="Save changes"
      pendingLabel="Saving…"
      choreId="chore_1"
      cancelHref="/chores"
      storedDueAt={STORED}
      {...overrides}
    />
  );
}

let container: HTMLDivElement;
let root: Root | null;

function input(name: string): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function type(element: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setValue.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(overrides: Partial<Props> = {}) {
  root = createRoot(container);
  await act(async () => root!.render(editForm(overrides)));
}

beforeEach(() => {
  updateChore.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
});

describe("ChoreForm when editing: due date", () => {
  it("renders an empty field and the unchanged marker on the server, with a noscript line", () => {
    container.innerHTML = renderToString(editForm());

    expect(input("dueAtLocal").value).toBe("");
    expect(input("dueAt").value).toBe("unchanged");
    expect(container.querySelector("noscript")!.innerHTML).toContain(
      `Currently due ${formatUtcDateTime(new Date(STORED))}. Changing the due date needs JavaScript; leave the field empty to keep it.`,
    );
  });

  it("has no noscript line for a chore without a due date", () => {
    container.innerHTML = renderToString(editForm({ storedDueAt: null }));
    expect(container.querySelector("noscript")).toBeNull();
    expect(input("dueAt").value).toBe("unchanged");
  });

  it("fills the field in the browser's zone after hydration and sends the stored ISO exactly", async () => {
    container.innerHTML = renderToString(editForm());
    await act(async () => {
      root = hydrateRoot(container, editForm());
    });

    expect(input("dueAtLocal").value).toBe(utcIsoToLocal(STORED));
    expect(input("dueAt").value).toBe(STORED);
  });

  it("leaves a date typed before hydration as it is and converts it", async () => {
    container.innerHTML = renderToString(editForm());
    input("dueAtLocal").value = "2026-12-24T18:00";
    await act(async () => {
      root = hydrateRoot(container, editForm());
    });

    expect(input("dueAtLocal").value).toBe("2026-12-24T18:00");
    expect(input("dueAt").value).toBe(localToUtcIso("2026-12-24T18:00"));
  });

  it("keeps the stored ISO after blur and keyup on an untouched field", async () => {
    await mount();
    for (const eventType of ["keyup", "focusout"]) {
      act(() => {
        input("dueAtLocal").dispatchEvent(new Event(eventType, { bubbles: true }));
      });
      expect(input("dueAt").value).toBe(STORED);
    }
  });

  it("converts a changed date, clears to an empty value, and goes back to the stored ISO", async () => {
    await mount();

    act(() => type(input("dueAtLocal"), "2027-01-05T08:15"));
    expect(input("dueAt").value).toBe(localToUtcIso("2027-01-05T08:15"));

    act(() => type(input("dueAtLocal"), ""));
    expect(input("dueAt").value).toBe("");

    act(() => type(input("dueAtLocal"), utcIsoToLocal(STORED)));
    expect(input("dueAt").value).toBe(STORED);
  });

  it("keeps an empty field and sends an empty value for a chore without a due date", async () => {
    await mount({ storedDueAt: null });
    expect(input("dueAtLocal").value).toBe("");
    expect(input("dueAt").value).toBe("");
  });

  it("lets the echoed value win after a refusal, twice in a row", async () => {
    updateChore.mockResolvedValue({
      values: { ...values, title: "", dueAtLocal: "2027-02-01T07:00" },
      errors: { title: ["Enter a chore title."] },
    });
    await mount();
    act(() => type(input("dueAtLocal"), "2027-02-01T07:00"));

    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () => container.querySelector("form")!.requestSubmit());
      expect(input("dueAtLocal").value).toBe("2027-02-01T07:00");
      expect(input("dueAt").value).toBe(localToUtcIso("2027-02-01T07:00"));
    }
  });

  it("sends the stored ISO again after a refusal that echoes the filled-in value", async () => {
    let submitted: FormData | undefined;
    updateChore.mockImplementation(async (_prev, formData) => {
      submitted = formData;
      return {
        values: { ...values, title: "", dueAtLocal: String(formData.get("dueAtLocal")) },
        errors: { title: ["Enter a chore title."] },
      };
    });
    await mount();

    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(submitted!.get("dueAt")).toBe(STORED);
    expect(input("dueAt").value).toBe(STORED);
  });
});

describe("ChoreForm when editing: fields and controls", () => {
  it("shows the stored values, posts the chore id and has Save changes and Cancel", async () => {
    await mount();

    expect(input("title").value).toBe("Take out bins");
    const select = (name: string) => container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
    expect([select("priority").value, select("effort").value, select("categoryId").value, select("recurrence").value]).toEqual(
      ["high", "large", "cat_kitchen", "weekly"],
    );
    expect(input("choreId").type).toBe("hidden");
    expect(input("choreId").value).toBe("chore_1");
    expect(container.querySelector('button[type="submit"]')!.textContent).toBe("Save changes");
    const cancel = [...container.querySelectorAll("a")].find((a) => a.textContent === "Cancel")!;
    expect(cancel.getAttribute("href")).toBe("/chores");
    const ticked = [...container.querySelectorAll<HTMLInputElement>('input[name="assigneeIds"]')]
      .filter((box) => box.checked)
      .map((box) => box.value);
    expect(ticked).toEqual(["user_2"]);
  });

  it("shows a claim chore with the list hidden and nothing ticked, also after switching to Fixed", async () => {
    await mount({ values: { ...values, assignmentMode: "claim", assigneeIds: [] } });
    const assignees = container.querySelector<HTMLFieldSetElement>("#assignees")!;
    const radio = (value: string) =>
      container.querySelector<HTMLInputElement>(`input[name="assignmentMode"][value="${value}"]`)!;

    expect(radio("claim").checked).toBe(true);
    expect(assignees.hidden).toBe(true);
    act(() => radio("fixed").click());
    expect(assignees.hidden).toBe(false);
    expect([...assignees.querySelectorAll<HTMLInputElement>("input")].some((box) => box.checked)).toBe(false);
  });

  it("shows read-only assignment text instead of the radios and the list", async () => {
    await mount({
      assignmentReadOnly: {
        modeLabel: "Fixed — specific people",
        assigneeLine: "Assigned to Bob, Carol (former member)",
        note: "Only the person who created this chore or an admin can change how it's assigned.",
      },
    });

    expect(container.querySelector('input[name="assignmentMode"]')).toBeNull();
    expect(container.querySelector('input[name="assigneeIds"]')).toBeNull();
    const text = container.querySelector("form")!.textContent!;
    expect(text).toContain("Fixed — specific people");
    expect(text).toContain("Assigned to Bob, Carol (former member)");
    expect(text).toContain("Only the person who created this chore or an admin can change how it's assigned.");
  });

  it("shows a form-level refusal in an alert above the fields", async () => {
    updateChore.mockResolvedValue({ values, formError: "That chore no longer exists." });
    await mount();
    await act(async () => container.querySelector("form")!.requestSubmit());

    const alert = container.querySelector("form > p[role=alert]")!;
    expect(alert.textContent).toBe("That chore no longer exists.");
    expect(alert.compareDocumentPosition(input("title")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps Create chore, no chore id, no Cancel and an empty due date on create", async () => {
    root = createRoot(container);
    await act(async () =>
      root!.render(<ChoreForm categories={[]} members={members} />),
    );

    expect(container.querySelector('button[type="submit"]')!.textContent).toBe("Create chore");
    expect(input("choreId")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(input("dueAt").value).toBe("");
    expect(container.querySelector("noscript")).toBeNull();
  });
});
