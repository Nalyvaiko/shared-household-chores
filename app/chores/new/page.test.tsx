import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const categoryFindMany = vi.fn();
const membershipFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst, findMany: membershipFindMany },
    category: { findMany: categoryFindMany },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { default: NewChorePage, metadata } = await import("./page");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Smith Family" };
const membership = { id: "membership_1", userId: "user_1", householdId: "household_1", role: "member", household };

// In database order, which is not the display order.
const categories = [
  { id: "custom_2", name: "garden", builtIn: false },
  { id: "builtin_0", name: "Kitchen", builtIn: true },
  { id: "custom_1", name: "Bikes", builtIn: false },
  { id: "builtin_1", name: "Bathroom", builtIn: true },
];

// In the order the query returns them (createdAt, then id).
const memberRows = [
  { id: "membership_0", userId: "user_0", user: { name: "Zoe", email: "zoe@example.com" } },
  { id: "membership_1", userId: "user_1", user: { name: "Alice", email: "alice@example.com" } },
  { id: "membership_2", userId: "user_2", user: { name: null, email: "bob@example.com" } },
];

async function render() {
  return renderToStaticMarkup(await NewChorePage());
}

function options(html: string, selectId: string) {
  const select = html.match(new RegExp(`<select[^>]*id="${selectId}"[^>]*>(.*?)</select>`))?.[1] ?? "";
  return [...select.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map(
    (match) => ({ value: match[1], selected: Boolean(match[2]), label: match[3] }),
  );
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(membership);
  categoryFindMany.mockReset().mockResolvedValue(categories);
  membershipFindMany.mockReset().mockResolvedValue(memberRows);
  redirect.mockClear();
});

describe("/chores/new page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("New chore · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(NewChorePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fchores%2Fnew");
  });

  it("redirects a user with no household to /household/new", async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(NewChorePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
  });

  it("loads only the caller's household's categories", async () => {
    await render();

    expect(categoryFindMany).toHaveBeenCalledWith({
      where: { householdId: "household_1" },
      select: { id: true, name: true, builtIn: true },
    });
  });

  it("offers None first and selected, then built-ins, then custom categories by name", async () => {
    const html = await render();

    expect(options(html, "categoryId")).toEqual([
      { value: "", selected: true, label: "None" },
      { value: "builtin_1", selected: false, label: "Bathroom" },
      { value: "builtin_0", selected: false, label: "Kitchen" },
      { value: "custom_1", selected: false, label: "Bikes" },
      { value: "custom_2", selected: false, label: "garden" },
    ]);
  });

  it("defaults priority and effort to Medium", async () => {
    const html = await render();

    expect(options(html, "priority")).toEqual([
      { value: "low", selected: false, label: "Low" },
      { value: "medium", selected: true, label: "Medium" },
      { value: "high", selected: false, label: "High" },
      { value: "urgent", selected: false, label: "Urgent" },
    ]);
    expect(options(html, "effort")).toEqual([
      { value: "small", selected: false, label: "Small" },
      { value: "medium", selected: true, label: "Medium" },
      { value: "large", selected: false, label: "Large" },
    ]);
  });

  it("defaults Repeats to None", async () => {
    const html = await render();

    expect(options(html, "recurrence")).toEqual([
      { value: "none", selected: true, label: "None" },
      { value: "daily", selected: false, label: "Daily" },
      { value: "weekly", selected: false, label: "Weekly" },
      { value: "monthly", selected: false, label: "Monthly" },
    ]);
  });

  it("loads the household's members in the members page order", async () => {
    await render();

    expect(membershipFindMany).toHaveBeenCalledWith({
      where: { householdId: "household_1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, userId: true, user: { select: { name: true, email: true } } },
    });
  });

  it("renders Fixed checked and one unticked checkbox per member, by user id, with the caller marked", async () => {
    const html = await render();

    const inputs = (type: string) =>
      [...html.matchAll(new RegExp(`<input type="${type}"[^>]*>`, "g"))].map((match) => ({
        name: match[0].match(/name="([^"]*)"/)?.[1],
        value: match[0].match(/value="([^"]*)"/)?.[1],
        checked: match[0].includes('checked=""'),
      }));
    expect(inputs("radio")).toEqual([
      { name: "assignmentMode", value: "fixed", checked: true },
      { name: "assignmentMode", value: "claim", checked: false },
    ]);
    expect(inputs("checkbox")).toEqual([
      { name: "assigneeIds", value: "user_0", checked: false },
      { name: "assigneeIds", value: "user_1", checked: false },
      { name: "assigneeIds", value: "user_2", checked: false },
    ]);
    expect(html).toContain('Alice<span class="text-muted-foreground"> (you)</span>');
    expect(html).not.toContain('Zoe<span class="text-muted-foreground"> (you)</span>');
    expect(html).toContain("bob@example.com");
    expect(html).not.toMatch(/<fieldset[^>]*id="assignees"[^>]*hidden/);
  });

  it("has a noValidate form, a title with no maxLength, an empty local due field and a hidden UTC one", async () => {
    const html = await render();

    expect(html).toMatch(/<form[^>]*novalidate=""/i);
    expect(html).toMatch(/<input type="text"[^>]*id="title"[^>]*name="title"/);
    expect(html).not.toMatch(/maxLength|maxlength/);
    expect(html).toMatch(/<input type="datetime-local"[^>]*name="dueAtLocal" value=""/);
    expect(html).toMatch(/<input type="hidden" name="dueAt" value=""\/>/);
    expect(html).toContain("Due (optional)");
    expect(html).toContain(">Create chore</button>");
  });
});
