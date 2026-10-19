import { describe, expect, it } from "vitest";

import {
  CATEGORY_NAME_CONTROL_ERROR,
  CATEGORY_NAME_EMPTY_ERROR,
  CATEGORY_NAME_TOO_LONG_ERROR,
  categoryNameSchema,
  sameCategoryName,
} from "@/lib/category/validation";

function errorsFor(value: unknown): string[] {
  const parsed = categoryNameSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("categoryNameSchema", () => {
  it("trims both ends and keeps inner spaces as typed", () => {
    expect(categoryNameSchema.parse("  Garden  tools \t")).toBe("Garden  tools");
  });

  it.each(["", "   ", "\t \n"])("rejects an empty name (%j)", (value) => {
    expect(errorsFor(value)).toEqual([CATEGORY_NAME_EMPTY_ERROR]);
  });

  it("rejects a non-string with the empty message", () => {
    expect(errorsFor(undefined)).toEqual([CATEGORY_NAME_EMPTY_ERROR]);
  });

  it.each([
    ["a newline", "Garden\ntools"],
    ["a tab", "Garden\ttools"],
    ["NUL", "Garden\u0000"],
    ["DEL", "Garden\u007f"],
    ["U+0085 (NEL)", "Garden\u0085tools"],
    ["U+009F", "Garden\u009f"],
  ])("rejects %s inside the name", (_label, value) => {
    expect(errorsFor(value)).toEqual([CATEGORY_NAME_CONTROL_ERROR]);
  });

  it("accepts 30 code points, including 30 emoji (60 UTF-16 units)", () => {
    expect(errorsFor("a".repeat(30))).toEqual([]);
    const emoji = "🧹".repeat(30);
    expect(emoji.length).toBe(60);
    expect(categoryNameSchema.parse(emoji)).toBe(emoji);
  });

  it("rejects 31 code points", () => {
    expect(errorsFor("a".repeat(31))).toEqual([CATEGORY_NAME_TOO_LONG_ERROR]);
    expect(errorsFor("🧹".repeat(31))).toEqual([CATEGORY_NAME_TOO_LONG_ERROR]);
  });

  it("counts the length after trimming", () => {
    expect(errorsFor(`  ${"a".repeat(30)}  `)).toEqual([]);
  });
});

describe("sameCategoryName", () => {
  it.each([
    ["kitchen", "Kitchen"],
    ["ADMIN", "Admin"],
    ["GARDEN", "Garden"],
  ])("treats %j and %j as the same name", (a, b) => {
    expect(sameCategoryName(a, b)).toBe(true);
  });

  it.each([
    ["Straße", "STRASSE"],
    ["İ", "i"],
    ["é", "é"],
    ["Garden tools", "Garden  tools"],
  ])("treats %j and %j as different names", (a, b) => {
    expect(sameCategoryName(a, b)).toBe(false);
  });
});
