import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { UserMenu } from "@/components/user-menu";

// React only warns about act() outside tests when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMAIL = "alice.with.a.long.address@example.com";

let root: Root | null = null;

beforeAll(() => {
  // The menu content measures itself; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render(hasHousehold: boolean, signOutAction = vi.fn(async () => {})) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <UserMenu email={EMAIL} hasHousehold={hasHousehold} signOutAction={signOutAction} />,
    );
  });
  return container;
}

function trigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="Account menu for ${EMAIL}"]`,
  )!;
}

/** Opens the menu from the keyboard, as Enter on the trigger does. */
function openMenu() {
  act(() => {
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

function items(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => ({
    text: item.textContent,
    href: item.getAttribute("href"),
  }));
}

describe("UserMenu", () => {
  it("shows the email, truncated, on a trigger named after it, with the menu closed", () => {
    render(true);

    const button = trigger();
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const label = button.querySelector("span")!;
    expect(label.textContent).toBe(EMAIL);
    expect(label.className).toMatch(/\btruncate\b/);
    expect(button.className).toMatch(/\bmax-w-30\b/);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("gives a user with a household Members, Categories and Settings, then Sign out", () => {
    render(true);

    const menu = openMenu();

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(items(menu)).toEqual([
      { text: "Members", href: "/household/members" },
      { text: "Categories", href: "/household/categories" },
      { text: "Settings", href: "/household/settings" },
      { text: "Sign out", href: null },
    ]);
    for (const link of menu.querySelectorAll('[role="menuitem"][href]')) {
      expect(link.tagName).toBe("A");
    }
  });

  it("gives a user without a household only Sign out", () => {
    render(false);

    const menu = openMenu();

    expect(items(menu)).toEqual([{ text: "Sign out", href: null }]);
    expect(menu.querySelector("a")).toBeNull();
  });

  it("shows the full email, wrapping, under Signed in as", () => {
    render(false);

    const menu = openMenu();

    expect(menu.textContent).toContain("Signed in as");
    const full = [...menu.querySelectorAll("span")].find((span) => span.textContent === EMAIL)!;
    expect(full).toBeDefined();
    expect(full.className).toMatch(/\bbreak-all\b/);
    expect(full.className).not.toMatch(/\btruncate\b/);
  });

  it("submits the sign-out form, which lives outside the menu, when Sign out is chosen", () => {
    render(true);
    const form = document.querySelector<HTMLFormElement>("form[hidden]")!;
    const requestSubmit = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    const menu = openMenu();
    expect(menu.contains(form)).toBe(false);
    const signOut = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Sign out",
    )!;
    act(() => signOut.click());

    expect(requestSubmit).toHaveBeenCalledTimes(1);
    // The menu stays open until the sign-out redirect replaces the page.
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });
});
