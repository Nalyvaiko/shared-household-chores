import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDateTime } from "@/components/local-date-time";
import { formatLocalDateTime } from "@/lib/date-time-format";

// React only warns about act() outside tests when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISO = "2026-10-23T14:05:00.000Z";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("LocalDateTime", () => {
  it("renders the UTC text on the server", () => {
    expect(renderToString(<LocalDateTime iso={ISO} />)).toBe(
      `<time dateTime="${ISO}">23 Oct 2026, 14:05 UTC</time>`,
    );
  });

  it("hydrates without a mismatch, then shows the browser's local time", async () => {
    const errors = vi.spyOn(console, "error");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<LocalDateTime iso={ISO} />);
    document.body.append(container);
    const recoverable = vi.fn();

    await act(async () => {
      root = hydrateRoot(container, <LocalDateTime iso={ISO} />, {
        onRecoverableError: recoverable,
      });
    });

    const time = container.querySelector("time")!;
    expect(time.getAttribute("dateTime")).toBe(ISO);
    expect(time.textContent).toBe(formatLocalDateTime(new Date(ISO)));
    expect(time.textContent).not.toContain("UTC");
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("formatLocalDateTime", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("uses the en-GB format in the runtime's zone without a zone name", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(formatLocalDateTime(new Date(ISO))).toBe("23 Oct 2026, 23:05");
    process.env.TZ = "America/New_York";
    expect(formatLocalDateTime(new Date(ISO))).toBe("23 Oct 2026, 10:05");
  });
});
