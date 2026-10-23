import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateChoreState } from "@/app/chores/new/actions";
import { DUE_AT_TIME_ZONE_ERROR } from "@/lib/chore/validation";

const createChore = vi.fn<(prev: CreateChoreState, formData: FormData) => Promise<CreateChoreState>>();
vi.mock("@/app/chores/new/actions", () => ({ createChore }));

const { ChoreForm } = await import("./chore-form");

// Tells React this is a test environment, so `act()` works without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** The defaults for the fields a test doesn't care about. */
const unassigned = { recurrence: "none", assignmentMode: "fixed", assigneeIds: [] as string[] };

/** The new-chore defaults, as the action echoes them. */
const NEW_VALUES = {
  title: "",
  dueAtLocal: "",
  priority: "medium",
  effort: "medium",
  categoryId: "",
  ...unassigned,
};

// In members page order.
const members = [
  { userId: "user_1", name: "Alice", email: "alice@example.com", isSelf: true },
  { userId: "user_2", name: null, email: "bob@example.com", isSelf: false },
  { userId: "user_3", name: "Alice", email: "alice2@example.com", isSelf: false },
];

function input(name: string): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

/** Types into an input the way the browser does, so React's onChange runs. */
function type(element: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setValue.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(async () => {
  createChore.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ChoreForm categories={[{ id: "cat_kitchen", name: "Kitchen" }]} members={members} />,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChoreForm due date", () => {
  it("starts with both due fields empty", () => {
    expect(input("dueAtLocal").value).toBe("");
    expect(input("dueAt").value).toBe("");
  });

  it("fills the hidden UTC field as the local one changes, and clears it again", () => {
    act(() => type(input("dueAtLocal"), "2026-03-10T09:30"));
    expect(input("dueAt").value).toBe(new Date(2026, 2, 10, 9, 30).toISOString());

    act(() => type(input("dueAtLocal"), ""));
    expect(input("dueAt").value).toBe("");
  });

  it.each(["keyup", "focusout"])(
    "writes the invalid marker for a half-typed date on %s, which fires no change event",
    (eventType) => {
      const local = input("dueAtLocal");
      // A half-filled datetime-local reads as "" but reports bad input.
      Object.defineProperty(local, "validity", { value: { badInput: true }, configurable: true });

      act(() => {
        local.dispatchEvent(new Event(eventType, { bubbles: true }));
      });
      expect(input("dueAt").value).toBe("invalid");
    },
  );

  it("recomputes the hidden UTC field from the echoed local value after a refusal", async () => {
    let submitted: FormData | undefined;
    createChore.mockImplementation(async (_prev, formData) => {
      submitted = formData;
      return {
        values: {
          title: "",
          dueAtLocal: "2026-03-10T09:30",
          priority: "medium",
          effort: "medium",
          categoryId: "",
          ...unassigned,
        },
        errors: { title: ["Enter a chore title."] },
      };
    });

    act(() => type(input("dueAtLocal"), "2026-03-10T09:30"));
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });

    expect(submitted?.get("dueAt")).toBe(new Date(2026, 2, 10, 9, 30).toISOString());
    // React reset the form to the echoed values; the UTC value came back too.
    expect(input("dueAtLocal").value).toBe("2026-03-10T09:30");
    expect(input("dueAt").value).toBe(new Date(2026, 2, 10, 9, 30).toISOString());
  });

  it("keeps non-default priority, effort and category choices after a refusal, twice in a row", async () => {
    const echoed = {
      title: "",
      dueAtLocal: "",
      priority: "high",
      effort: "large",
      categoryId: "cat_kitchen",
      ...unassigned,
    };
    createChore.mockResolvedValue({ values: echoed, errors: { title: ["Enter a chore title."] } });
    const select = (name: string) =>
      container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;

    act(() => {
      select("priority").value = "high";
      select("effort").value = "large";
      select("categoryId").value = "cat_kitchen";
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () => {
        container.querySelector("form")!.requestSubmit();
      });

      expect(select("priority").value).toBe("high");
      expect(select("effort").value).toBe("large");
      expect(select("categoryId").value).toBe("cat_kitchen");
    }
    // What the next submit sends.
    const sent = new FormData(container.querySelector("form")!);
    expect([sent.get("priority"), sent.get("effort"), sent.get("categoryId")]).toEqual([
      "high",
      "large",
      "cat_kitchen",
    ]);
  });

  it("selects None again when the chosen category was refused", async () => {
    createChore.mockResolvedValue({
      values: { title: "Bins", dueAtLocal: "", priority: "high", effort: "medium", categoryId: "", ...unassigned },
      errors: { categoryId: ["That category no longer exists. Choose another one."] },
    });
    const category = container.querySelector<HTMLSelectElement>("select[name=categoryId]")!;
    act(() => {
      category.value = "cat_kitchen";
    });

    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });

    expect(container.querySelector<HTMLSelectElement>("select[name=categoryId]")!.value).toBe("");
    expect(container.querySelector<HTMLSelectElement>("select[name=priority]")!.value).toBe("high");
  });

  it("marks each refused field and shows its message next to it", async () => {
    createChore.mockResolvedValue({
      values: {
        title: "Bins",
        dueAtLocal: "2026-03-10T09:30",
        priority: "medium",
        effort: "medium",
        categoryId: "",
        ...unassigned,
      },
      errors: { dueAt: [DUE_AT_TIME_ZONE_ERROR], categoryId: ["That category no longer exists. Choose another one."] },
    });

    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });

    expect(input("title").value).toBe("Bins");
    expect(input("title").getAttribute("aria-invalid")).toBeNull();
    expect(input("dueAtLocal").getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("#dueAt-error")?.getAttribute("role")).toBe("alert");
    expect(container.querySelector("#dueAt-error")?.textContent).toBe(DUE_AT_TIME_ZONE_ERROR);
    const category = container.querySelector<HTMLSelectElement>("select[name=categoryId]")!;
    expect(category.getAttribute("aria-invalid")).toBe("true");
    expect(category.value).toBe("");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
  });
});

describe("ChoreForm recurrence and assignment", () => {
  const form = () => container.querySelector("form")!;
  const select = (name: string) =>
    container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  const radio = (value: string) =>
    container.querySelector<HTMLInputElement>(`input[name="assignmentMode"][value="${value}"]`)!;
  const checkbox = (userId: string) =>
    container.querySelector<HTMLInputElement>(`input[name="assigneeIds"][value="${userId}"]`)!;
  const assignees = () => container.querySelector<HTMLFieldSetElement>("#assignees")!;
  const ticked = () =>
    [...container.querySelectorAll<HTMLInputElement>('input[name="assigneeIds"]')]
      .filter((box) => box.checked)
      .map((box) => box.value);

  /** Refuses the title and echoes the rest the way the action does. */
  function refuseTitle() {
    createChore.mockImplementation(async (_prev, formData) => {
      const mode = String(formData.get("assignmentMode") ?? "");
      return {
        values: {
          title: "",
          dueAtLocal: "",
          priority: String(formData.get("priority")),
          effort: String(formData.get("effort")),
          categoryId: String(formData.get("categoryId")),
          recurrence: String(formData.get("recurrence")),
          assignmentMode: mode,
          assigneeIds: mode === "claim" ? [] : formData.getAll("assigneeIds").map(String),
        },
        errors: { title: ["Enter a chore title."] },
      };
    });
  }

  async function submit() {
    await act(async () => {
      form().requestSubmit();
    });
  }

  it("defaults to None, Fixed and nobody ticked, the caller included", () => {
    expect(select("recurrence").value).toBe("none");
    expect([...select("recurrence").options].map((option) => [option.value, option.text])).toEqual([
      ["none", "None"],
      ["daily", "Daily"],
      ["weekly", "Weekly"],
      ["monthly", "Monthly"],
    ]);
    expect(radio("fixed").checked).toBe(true);
    expect(radio("claim").checked).toBe(false);
    expect(radio("fixed").closest("label")!.textContent).toBe("Fixed — specific people");
    expect(radio("claim").closest("label")!.textContent).toBe("Claim — anyone can claim it");
    expect(assignees().hidden).toBe(false);
    expect(ticked()).toEqual([]);
  });

  it("lists every member in the given order with name, email and (you)", () => {
    const labels = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="assigneeIds"]'),
    ].map((box) => [box.value, box.closest("label")!.textContent]);
    expect(labels).toEqual([
      ["user_1", "Alice (you)alice@example.com"],
      // No name: the email is the label, shown once.
      ["user_2", "bob@example.com"],
      ["user_3", "Alicealice2@example.com"],
    ]);
  });

  it("hides the list when Claim is chosen and shows it again with the ticks kept", () => {
    act(() => checkbox("user_2").click());
    act(() => radio("claim").click());
    expect(assignees().hidden).toBe(true);
    // The re-render doesn't put the default back.
    expect(radio("claim").checked).toBe(true);
    expect(radio("fixed").checked).toBe(false);

    act(() => radio("fixed").click());
    expect(radio("fixed").checked).toBe(true);
    expect(assignees().hidden).toBe(false);
    expect(ticked()).toEqual(["user_2"]);
  });

  it("keeps recurrence, Fixed and the ticks after a refusal, twice in a row, in member order", async () => {
    refuseTitle();
    act(() => {
      select("recurrence").value = "weekly";
    });
    act(() => checkbox("user_3").click());
    act(() => checkbox("user_1").click());

    for (let attempt = 0; attempt < 2; attempt++) {
      await submit();

      expect(select("recurrence").value).toBe("weekly");
      expect(radio("fixed").checked).toBe(true);
      expect(assignees().hidden).toBe(false);
      expect(ticked()).toEqual(["user_1", "user_3"]);
    }
    // What the next submit sends.
    const sent = new FormData(form());
    expect(sent.get("recurrence")).toBe("weekly");
    expect(sent.get("assignmentMode")).toBe("fixed");
    expect(sent.getAll("assigneeIds")).toEqual(["user_1", "user_3"]);
  });

  it("keeps Claim with the list hidden after a refusal, twice in a row, and echoes no ticks", async () => {
    refuseTitle();
    act(() => {
      select("recurrence").value = "monthly";
    });
    act(() => checkbox("user_2").click());
    act(() => radio("claim").click());

    for (let attempt = 0; attempt < 2; attempt++) {
      await submit();

      expect(select("recurrence").value).toBe("monthly");
      expect(radio("claim").checked).toBe(true);
      expect(radio("fixed").checked).toBe(false);
      expect(assignees().hidden).toBe(true);
    }
    expect(new FormData(form()).get("assignmentMode")).toBe("claim");

    act(() => radio("fixed").click());
    expect(assignees().hidden).toBe(false);
    expect(ticked()).toEqual([]);
  });

  it("shows the list again after a Fixed refusal that follows a Claim one", async () => {
    refuseTitle();
    act(() => radio("claim").click());
    await submit();
    expect(assignees().hidden).toBe(true);

    act(() => radio("fixed").click());
    act(() => checkbox("user_3").click());
    expect(radio("fixed").checked).toBe(true);
    await submit();

    expect(radio("fixed").checked).toBe(true);
    expect(assignees().hidden).toBe(false);
    expect(ticked()).toEqual(["user_3"]);
  });

  it("drops a refused member's tick, keeps the others and shows the message under the list", async () => {
    const message =
      "Someone you picked is no longer in this household. Check the list and try again.";
    createChore.mockResolvedValue({
      values: {
        title: "Bins",
        dueAtLocal: "",
        priority: "medium",
        effort: "medium",
        categoryId: "",
        ...unassigned,
        assigneeIds: ["user_1"],
      },
      errors: { assigneeIds: [message] },
    });
    act(() => checkbox("user_1").click());
    act(() => checkbox("user_2").click());

    await submit();

    expect(ticked()).toEqual(["user_1"]);
    expect(assignees().getAttribute("aria-invalid")).toBe("true");
    expect(assignees().querySelector("#assigneeIds-error")?.textContent).toBe(message);
  });

  it("keeps the converted due date when the mode is toggled both ways, several times", async () => {
    let submitted: FormData | undefined;
    createChore.mockImplementation(async (_prev, formData) => {
      submitted = formData;
      return { values: { ...NEW_VALUES, title: "Bins" }, errors: { title: ["Enter a chore title."] } };
    });
    const expected = new Date(2026, 11, 1, 9, 30).toISOString();

    act(() => type(input("dueAtLocal"), "2026-12-01T09:30"));
    expect(input("dueAt").value).toBe(expected);
    for (const mode of ["claim", "fixed", "claim", "fixed", "claim"]) {
      act(() => radio(mode).click());
      expect(input("dueAt").value).toBe(expected);
    }
    await submit();

    expect(submitted?.get("dueAt")).toBe(expected);
    expect(submitted?.get("assignmentMode")).toBe("claim");
  });

  it("keeps the converted due date, the title and the selects when ticks change after the date", async () => {
    let submitted: FormData | undefined;
    createChore.mockImplementation(async (_prev, formData) => {
      submitted = formData;
      return { values: NEW_VALUES };
    });
    const expected = new Date(2026, 11, 1, 9, 30).toISOString();

    act(() => type(input("title"), "Bins"));
    act(() => type(input("dueAtLocal"), "2026-12-01T09:30"));
    act(() => {
      select("recurrence").value = "weekly";
      select("priority").value = "high";
      select("categoryId").value = "cat_kitchen";
    });
    act(() => checkbox("user_2").click());
    act(() => checkbox("user_3").click());
    act(() => radio("claim").click());
    act(() => radio("fixed").click());
    act(() => checkbox("user_2").click());

    expect(input("dueAt").value).toBe(expected);
    await submit();

    expect(submitted?.get("title")).toBe("Bins");
    expect(submitted?.get("dueAt")).toBe(expected);
    expect(submitted?.get("recurrence")).toBe("weekly");
    expect(submitted?.get("priority")).toBe("high");
    expect(submitted?.get("categoryId")).toBe("cat_kitchen");
    expect(submitted?.get("assignmentMode")).toBe("fixed");
    expect(submitted?.getAll("assigneeIds")).toEqual(["user_3"]);
  });

  it("keeps the invalid marker for a half-typed date through a mode toggle", () => {
    const local = input("dueAtLocal");
    Object.defineProperty(local, "validity", { value: { badInput: true }, configurable: true });
    act(() => {
      local.dispatchEvent(new Event("focusout", { bubbles: true }));
    });

    act(() => radio("claim").click());
    expect(input("dueAt").value).toBe("invalid");
  });

  it("re-converts the echoed date after a refusal, and keeps it through later mode toggles", async () => {
    createChore.mockResolvedValue({
      values: { ...NEW_VALUES, dueAtLocal: "2026-12-01T09:30", assignmentMode: "claim" },
      errors: { title: ["Enter a chore title."] },
    });
    const expected = new Date(2026, 11, 1, 9, 30).toISOString();

    act(() => type(input("dueAtLocal"), "2026-12-01T09:30"));
    act(() => radio("claim").click());
    await submit();
    expect(input("dueAt").value).toBe(expected);

    act(() => radio("fixed").click());
    act(() => radio("claim").click());
    expect(input("dueAt").value).toBe(expected);
    expect(new FormData(form()).get("dueAt")).toBe(expected);
  });

  it("starts from the values it is given", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChoreForm
          categories={[]}
          members={members}
          values={{
            title: "Bins",
            dueAtLocal: "",
            priority: "high",
            effort: "small",
            categoryId: "",
            recurrence: "daily",
            assignmentMode: "claim",
            assigneeIds: [],
          }}
        />,
      );
    });

    expect(input("title").value).toBe("Bins");
    expect(select("recurrence").value).toBe("daily");
    expect(radio("claim").checked).toBe(true);
    expect(assignees().hidden).toBe(true);
  });
});
