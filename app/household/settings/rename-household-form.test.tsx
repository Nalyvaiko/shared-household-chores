import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenameHouseholdState } from "@/app/household/settings/actions";
import {
  ADMIN_ONLY_ERROR,
  HOUSEHOLD_RENAMED_MESSAGE,
} from "@/app/household/settings/messages";
import { HOUSEHOLD_NAME_EMPTY_ERROR } from "@/lib/household/validation";

const renameHousehold =
  vi.fn<(prev: RenameHouseholdState, formData: FormData) => Promise<RenameHouseholdState>>();
vi.mock("@/app/household/settings/actions", () => ({ renameHousehold }));

const { RenameHouseholdForm } = await import("./rename-household-form");

// Tells React this is a test environment, so `act()` works without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function nameInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[name="name"]')!;
}

/** Types into an input the way the browser does, so React's onChange runs. */
function type(element: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setValue.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit() {
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
  });
}

beforeEach(async () => {
  renameHousehold.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<RenameHouseholdForm currentName="Smith Family" />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("RenameHouseholdForm", () => {
  it("starts with the current name and no message", () => {
    expect(nameInput().value).toBe("Smith Family");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("shows the success message and the saved name after a rename", async () => {
    renameHousehold.mockResolvedValue({ name: "Flat 4", success: HOUSEHOLD_RENAMED_MESSAGE });

    act(() => type(nameInput(), "  Flat 4  "));
    await submit();

    expect(renameHousehold.mock.calls[0][1].get("name")).toBe("  Flat 4  ");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Household renamed.");
    expect(nameInput().value).toBe("Flat 4");
  });

  it.each([HOUSEHOLD_NAME_EMPTY_ERROR, ADMIN_ONLY_ERROR])(
    "shows %j and keeps what was typed after a refusal",
    async (error) => {
      renameHousehold.mockResolvedValue({ name: "   ", error });

      act(() => type(nameInput(), "   "));
      await submit();

      expect(container.querySelector('[role="alert"]')?.textContent).toBe(error);
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(nameInput().value).toBe("   ");
      expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    },
  );
});
