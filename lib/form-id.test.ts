import { describe, expect, it } from "vitest";

import { formId, isPlausibleId, MAX_ID_LENGTH } from "@/lib/form-id";

function form(value?: FormDataEntryValue): FormData {
  const data = new FormData();
  if (value !== undefined) data.set("id", value);
  return data;
}

describe("formId", () => {
  it("returns a plausible id unchanged", () => {
    expect(formId(form("cmh1abc2d0000xyz"), "id")).toBe("cmh1abc2d0000xyz");
    expect(formId(form("a".repeat(MAX_ID_LENGTH)), "id")).toBe("a".repeat(MAX_ID_LENGTH));
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "  \t "],
    ["a NUL byte", "chore_1\u0000"],
    ["only a NUL byte", "\u0000"],
    ["a newline", "chore\n1"],
    ["DEL", "chore\u007f1"],
    ["a C1 control", "chore\u00851"],
    ["over-long", "a".repeat(MAX_ID_LENGTH + 1)],
  ])("returns null for %s", (_label, value) => {
    expect(formId(form(value), "id")).toBeNull();
  });

  it("returns null for a file", () => {
    expect(formId(form(new File(["x"], "id.txt")), "id")).toBeNull();
  });
});

describe("isPlausibleId", () => {
  it("rejects non-strings", () => {
    expect(isPlausibleId(null)).toBe(false);
    expect(isPlausibleId(42)).toBe(false);
  });
});
