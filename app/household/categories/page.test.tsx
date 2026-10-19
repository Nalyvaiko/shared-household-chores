import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const categoryFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst },
    category: { findMany: categoryFindMany },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { default: CategoriesPage, metadata } = await import("./page");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Smith Family" };

function callerMembership(role: "admin" | "member") {
  return { id: "membership_1", userId: "user_1", householdId: "household_1", role, household };
}

// In database order, which is not the display order.
const builtIns = ["Kitchen", "Bathroom", "Cleaning", "Laundry", "Outdoor", "Pets", "Admin"].map(
  (name, index) => ({ id: `builtin_${index}`, name, builtIn: true }),
);
const customs = [
  { id: "custom_2", name: "garden", builtIn: false },
  { id: "custom_1", name: "Bikes", builtIn: false },
];

async function render() {
  return renderToStaticMarkup(await CategoriesPage());
}

function rowNames(html: string): string[] {
  return [...html.matchAll(/<li[^>]*><span[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]);
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(callerMembership("member"));
  categoryFindMany.mockReset().mockResolvedValue([...customs, ...builtIns]);
  redirect.mockClear();
});

describe("/household/categories page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("Categories · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin with a callbackUrl back here", async () => {
    auth.mockResolvedValue(null);

    await expect(CategoriesPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fhousehold%2Fcategories");
  });

  it("redirects a user with no household to /household/new", async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(CategoriesPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
  });

  it("loads only the caller's household's categories, with no chore counts", async () => {
    await render();

    expect(categoryFindMany).toHaveBeenCalledWith({
      where: { householdId: "household_1" },
      select: { id: true, name: true, builtIn: true },
    });
  });

  it("lists built-ins first, then custom ones, each by name", async () => {
    const html = await render();

    expect(rowNames(html)).toEqual([
      "Admin",
      "Bathroom",
      "Cleaning",
      "Kitchen",
      "Laundry",
      "Outdoor",
      "Pets",
      "Bikes",
      "garden",
    ]);
  });

  it("labels built-ins and gives only custom rows a Delete button", async () => {
    const html = await render();

    expect(html.match(/>Built-in</g)).toHaveLength(7);
    expect(html.match(/>Delete</g)).toHaveLength(2);
    expect(html).not.toContain("No custom categories yet.");
  });

  it("shows the empty custom state when there are only built-ins", async () => {
    categoryFindMany.mockResolvedValue(builtIns);

    const html = await render();

    expect(html.match(/>Built-in</g)).toHaveLength(7);
    expect(html).not.toContain(">Delete<");
    expect(html).toContain("No custom categories yet.");
  });

  it("shows the add form with no maxLength on the input", async () => {
    const html = await render();

    expect(html).toContain("Category name");
    expect(html).toContain("Add category");
    expect(html).not.toMatch(/maxLength|maxlength/);
  });
});
