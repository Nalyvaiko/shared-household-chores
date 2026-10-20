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
    root.render(<ChoreForm categories={[{ id: "cat_kitchen", name: "Kitchen" }]} />);
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

  it("marks each refused field and shows its message next to it", async () => {
    createChore.mockResolvedValue({
      values: {
        title: "Bins",
        dueAtLocal: "2026-03-10T09:30",
        priority: "medium",
        effort: "medium",
        categoryId: "",
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
