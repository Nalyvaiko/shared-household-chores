import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ResetFormOnRestore } from "@/components/reset-form-on-restore";

// React only warns about act() outside tests when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mountForm() {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <>
        <form id="filters">
          <select name="status" defaultValue="pending">
            <option value="pending">Pending</option>
            <option value="done">Done</option>
          </select>
          <input type="checkbox" name="overdue" value="1" defaultChecked={false} />
        </form>
        <ResetFormOnRestore formId="filters" />
      </>,
    );
  });
  const select = container.querySelector("select")!;
  const checkbox = container.querySelector<HTMLInputElement>('input[name="overdue"]')!;
  // Edits that were never applied, as the restored page would still show them.
  select.value = "done";
  checkbox.checked = true;
  return { select, checkbox };
}

function pageshow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("ResetFormOnRestore", () => {
  it("resets edited controls to their defaults on a back-forward cache restore", () => {
    const { select, checkbox } = mountForm();

    pageshow(true);

    expect(select.value).toBe("pending");
    expect(checkbox.checked).toBe(false);
  });

  it("leaves the controls alone on a normal page show", () => {
    const { select, checkbox } = mountForm();

    pageshow(false);

    expect(select.value).toBe("done");
    expect(checkbox.checked).toBe(true);
  });

  it("stops listening once unmounted", () => {
    const { select } = mountForm();
    act(() => root?.unmount());
    root = null;

    pageshow(true);

    expect(select.value).toBe("done");
  });
});
