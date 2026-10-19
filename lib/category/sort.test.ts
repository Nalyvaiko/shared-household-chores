import { describe, expect, it } from "vitest";

import { sortCategories } from "@/lib/category/sort";

function category(id: string, name: string, builtIn: boolean) {
  return { id, name, builtIn };
}

describe("sortCategories", () => {
  it("puts built-ins first, then custom categories, each by name", () => {
    const sorted = sortCategories([
      category("c1", "garden", false),
      category("b1", "Kitchen", true),
      category("c2", "Bikes", false),
      category("b2", "Admin", true),
      category("b3", "Pets", true),
    ]);

    expect(sorted.map((row) => row.name)).toEqual(["Admin", "Kitchen", "Pets", "Bikes", "garden"]);
  });

  it("ignores case and accents and breaks ties by id", () => {
    const sorted = sortCategories([
      category("c3", "cafe", false),
      category("c1", "Café", false),
      category("c2", "Apple", false),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["c2", "c1", "c3"]);
  });

  it("does not change the input array", () => {
    const input = [category("c2", "B", false), category("c1", "A", false)];

    sortCategories(input);

    expect(input.map((row) => row.id)).toEqual(["c2", "c1"]);
  });
});
