import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const membershipFindMany = vi.fn();
const categoryFindMany = vi.fn();
const choreFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst, findMany: membershipFindMany },
    category: { findMany: categoryFindMany },
    chore: { findFirst: choreFindFirst },
  },
}));

// Like the real ones, `redirect` and `notFound` throw so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ redirect, notFound }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The forms post to these; the actions have their own tests.
vi.mock("@/app/chores/[id]/edit/actions", () => ({ updateChore: vi.fn(), deleteChore: vi.fn() }));

const { default: EditChorePage, metadata } = await import("./page");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Home" };

function membershipOf(role: "admin" | "member") {
  return { id: "membership_1", userId: "user_1", householdId: "household_1", role, household };
}

const memberRows = [
  { id: "membership_0", userId: "user_0", user: { name: "Zoe", email: "zoe@example.com" } },
  { id: "membership_1", userId: "user_1", user: { name: "Alice", email: "alice@example.com" } },
  { id: "membership_2", userId: "user_2", user: { name: null, email: "bob@example.com" } },
];

const bob = { userId: "user_2", user: { name: null, email: "bob@example.com", memberships: [{ id: "membership_2" }] } };
const formerCarol = { userId: "user_9", user: { name: "Carol", email: "carol@example.com", memberships: [] } };

function chore(overrides: Record<string, unknown> = {}) {
  return {
    id: "chore_1",
    householdId: "household_1",
    createdById: "user_2",
    categoryId: "cat_kitchen",
    category: { name: "Kitchen" },
    title: "Take out bins",
    dueAt: new Date("2026-11-01T09:30:00.000Z"),
    priority: "high",
    effort: "small",
    status: "pending",
    recurrence: "weekly",
    assignmentMode: "fixed",
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    assignees: [bob, formerCarol],
    ...overrides,
  };
}

function render(id = "chore_1") {
  return EditChorePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
}

async function doc(id?: string) {
  return new DOMParser().parseFromString(renderToStaticMarkup(await render(id)), "text/html");
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(membershipOf("member"));
  membershipFindMany.mockReset().mockResolvedValue(memberRows);
  categoryFindMany.mockReset().mockResolvedValue([{ id: "cat_kitchen", name: "Kitchen", builtIn: true }]);
  choreFindFirst.mockReset().mockResolvedValue(chore());
  redirect.mockClear();
  notFound.mockClear();
});

describe("/chores/[id]/edit page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("Edit chore · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin with the callbackUrl", async () => {
    auth.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fchores%2Fchore_1%2Fedit");
  });

  it("redirects a user without a household to /household/new", async () => {
    membershipFindFirst.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /household/new");
  });

  it("loads the chore filtered by the caller's household", async () => {
    await render();
    expect(choreFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "chore_1", householdId: "household_1" } }),
    );
  });

  it("calls notFound() for an unknown or another household's chore, and for an empty id", async () => {
    choreFindFirst.mockResolvedValue(null);
    await expect(render("chore_other")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render("")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it("pre-fills a pending chore's form with Save changes and Cancel", async () => {
    const page = await doc();

    expect(page.querySelector("h1")!.textContent).toBe("Edit chore");
    expect(page.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("Take out bins");
    const selected = (name: string) =>
      page.querySelector(`select[name="${name}"] option[selected]`)?.getAttribute("value");
    expect(selected("priority")).toBe("high");
    expect(selected("effort")).toBe("small");
    expect(selected("recurrence")).toBe("weekly");
    expect(selected("categoryId")).toBe("cat_kitchen");
    expect(page.querySelector<HTMLInputElement>('input[name="choreId"]')!.value).toBe("chore_1");
    expect(page.querySelector<HTMLInputElement>('input[name="dueAt"]')!.value).toBe("unchanged");
    expect(page.querySelector<HTMLInputElement>('input[name="dueAtLocal"]')!.value).toBe("");
    expect(page.querySelector('button[type="submit"]')!.textContent).toBe("Save changes");
    expect([...page.querySelectorAll("a")].find((a) => a.textContent === "Cancel")!.getAttribute("href")).toBe(
      "/chores",
    );
  });

  it("shows None for a chore whose category was deleted", async () => {
    choreFindFirst.mockResolvedValue(chore({ categoryId: null, category: null }));
    const page = await doc();
    const options = [...page.querySelectorAll<HTMLOptionElement>('select[name="categoryId"] option')];
    expect(options.find((o) => o.hasAttribute("selected"))?.value ?? "").toBe("");
  });

  it("lets the creator change the assignment, ticking current members only, in members page order", async () => {
    choreFindFirst.mockResolvedValue(chore({ createdById: "user_1" }));
    const page = await doc();

    const boxes = [...page.querySelectorAll<HTMLInputElement>('input[name="assigneeIds"]')];
    expect(boxes.map((box) => [box.value, box.checked])).toEqual([
      ["user_0", false],
      ["user_1", false],
      ["user_2", true],
    ]);
    expect(boxes[1].closest("label")!.textContent).toContain("(you)");
    expect(page.querySelector('input[name="assignmentMode"][value="fixed"]')!.hasAttribute("checked")).toBe(true);
  });

  it("lets an admin change the assignment", async () => {
    membershipFindFirst.mockResolvedValue(membershipOf("admin"));
    const page = await doc();
    expect(page.querySelector('input[name="assignmentMode"]')).not.toBeNull();
  });

  it("shows a claim chore with nothing ticked, the claimant included", async () => {
    choreFindFirst.mockResolvedValue(chore({ createdById: "user_1", assignmentMode: "claim", assignees: [bob] }));
    const page = await doc();
    expect(page.querySelector('input[name="assignmentMode"][value="claim"]')!.hasAttribute("checked")).toBe(true);
    expect(page.querySelector<HTMLFieldSetElement>("#assignees")!.hidden).toBe(true);
    expect(page.querySelectorAll('input[name="assigneeIds"][checked]')).toHaveLength(0);
  });

  it("gives any other member read-only assignment text", async () => {
    const page = await doc();
    const text = page.querySelector("form")!.textContent!;

    expect(page.querySelector('input[name="assignmentMode"]')).toBeNull();
    expect(page.querySelector('input[name="assigneeIds"]')).toBeNull();
    expect(text).toContain("Fixed — specific people");
    expect(text).toContain("Assigned to bob@example.com, Carol (former member)");
    expect(text).toContain("Only the person who created this chore or an admin can change how it's assigned.");
  });

  it("shows the delete control to admins only, below the form, with the recurring note", async () => {
    expect((await doc()).querySelector("details")).toBeNull();

    membershipFindFirst.mockResolvedValue(membershipOf("admin"));
    const page = await doc();
    const details = page.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("Delete chore");
    expect(details.textContent).toContain('Delete "Take out bins"? This can\'t be undone.');
    expect(details.textContent).toContain("It repeats, so this also ends the series.");
    expect(details.querySelector<HTMLInputElement>('input[name="choreId"]')!.value).toBe("chore_1");
    expect(details.querySelector("button")!.textContent).toBe("Delete chore");
    expect(page.querySelector("form")!.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["completed", "skipped"])("shows a %s chore read-only, with Back to chores", async (status) => {
    choreFindFirst.mockResolvedValue(chore({ status }));
    const page = await doc();

    expect(page.querySelector("h1")!.textContent).toBe("Edit chore");
    expect(page.body.textContent).toContain(
      "This chore has already been completed or skipped, so it can't be edited.",
    );
    expect(page.querySelector('input[name="title"]')).toBeNull();
    expect([...page.querySelectorAll("a")].find((a) => a.textContent === "Back to chores")!.getAttribute("href")).toBe(
      "/chores",
    );
    expect(page.querySelector("details")).toBeNull();
  });

  it("gives an admin the delete control on a finished chore, without the recurring note", async () => {
    membershipFindFirst.mockResolvedValue(membershipOf("admin"));
    choreFindFirst.mockResolvedValue(chore({ status: "completed" }));
    const details = (await doc()).querySelector("details")!;

    expect(details.textContent).toContain('Delete "Take out bins"?');
    expect(details.textContent).not.toContain("It repeats");
  });
});
