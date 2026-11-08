import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DropSearchParam, urlWithoutSearchParam } from "@/components/drop-search-param";

// React only warns about act() outside tests when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

function mount(name: string) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(<DropSearchParam name={name} />);
  });
  return container;
}

describe("urlWithoutSearchParam", () => {
  it("drops only the named param, keeping the others in order and the hash", () => {
    expect(
      urlWithoutSearchParam(
        "http://localhost/chores?status=all&notice=saved&category=c1&overdue=1#list",
        "notice",
      ),
    ).toBe("/chores?status=all&category=c1&overdue=1#list");
  });

  it("drops every copy of the param and the bare ? when nothing is left", () => {
    expect(urlWithoutSearchParam("http://localhost/chores?notice=a&notice=b", "notice")).toBe(
      "/chores",
    );
  });

  it("returns null when the param isn't there", () => {
    expect(urlWithoutSearchParam("http://localhost/chores?status=all", "notice")).toBeNull();
  });
});

describe("DropSearchParam", () => {
  it("removes the param from the address bar with replaceState and renders nothing", () => {
    window.history.replaceState(null, "", "/chores?status=done&notice=deleted&category=none");
    const replace = vi.spyOn(window.history, "replaceState");

    const container = mount("notice");

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(null, "", "/chores?status=done&category=none");
    expect(window.location.pathname + window.location.search).toBe(
      "/chores?status=done&category=none",
    );
    expect(container.innerHTML).toBe("");
  });

  it("leaves the history alone when the param is already gone", () => {
    window.history.replaceState(null, "", "/chores?status=all");
    const replace = vi.spyOn(window.history, "replaceState");

    mount("notice");

    expect(replace).not.toHaveBeenCalled();
  });
});
