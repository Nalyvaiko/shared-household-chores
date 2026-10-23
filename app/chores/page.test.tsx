import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChoreActionState } from "@/app/chores/actions";

// The page resolves the user and household through the real guards, so the
// session and the database are mocked underneath them.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const userFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const categoryFindMany = vi.fn();
const choreFindMany = vi.fn();
const choreCount = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst },
    category: { findMany: categoryFindMany },
    chore: { findMany: choreFindMany, count: choreCount },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

// The rows' Complete forms post to this; the action has its own tests.
const completeChore = vi.fn<(prev: ChoreActionState, formData: FormData) => Promise<ChoreActionState>>();
vi.mock("@/app/chores/actions", () => ({ completeChore }));

const { default: ChoresPage, metadata } = await import("./page");

const NOW = new Date("2026-10-23T12:00:00.000Z");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const household = { id: "household_1", name: "Smith Family" };
const membership = { id: "membership_1", userId: "user_1", householdId: "household_1", role: "member", household };

const categories = [
  { id: "cat_zz", name: "Zebra care", builtIn: false },
  { id: "cat_kitchen", name: "Kitchen", builtIn: true },
  { id: "cat_bath", name: "Bathroom", builtIn: true },
];

function chore(overrides: Record<string, unknown>) {
  return {
    id: "chore_x",
    householdId: "household_1",
    createdById: "user_1",
    categoryId: null,
    category: null,
    title: "A chore",
    dueAt: null,
    priority: "medium",
    effort: "medium",
    status: "pending",
    recurrence: "none",
    assignmentMode: "fixed",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    assignees: [],
    ...overrides,
  };
}

const datedChore = chore({
  id: "chore_1",
  title: "Take out the bins",
  categoryId: "cat_kitchen",
  category: { name: "Kitchen" },
  dueAt: new Date("2026-10-22T08:30:00.000Z"),
  priority: "urgent",
  effort: "small",
  recurrence: "weekly",
  assignees: [
    {
      userId: "user_2",
      user: { name: "Bob", email: "bob@example.com", memberships: [] },
    },
    {
      userId: "user_1",
      user: { name: "Alice", email: "alice@example.com", memberships: [{ id: "membership_1" }] },
    },
  ],
});
const undatedChore = chore({
  id: "chore_2",
  title: "Water the plants",
  assignmentMode: "claim",
});

function render(params: Record<string, string | string[]> = {}) {
  return ChoresPage({ params: Promise.resolve({}), searchParams: Promise.resolve(params) });
}

function parse(markup: string) {
  return new DOMParser().parseFromString(markup, "text/html");
}

async function html(params: Record<string, string | string[]> = {}) {
  return renderToStaticMarkup(await render(params));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  auth.mockReset().mockResolvedValue(session);
  userFindUnique.mockReset().mockResolvedValue({ id: "user_1", email: "alice@example.com", name: "Alice" });
  membershipFindFirst.mockReset().mockResolvedValue(membership);
  categoryFindMany.mockReset().mockResolvedValue(categories);
  choreFindMany.mockReset().mockResolvedValue([datedChore, undatedChore]);
  choreCount.mockReset().mockResolvedValue(2);
  redirect.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/chores page", () => {
  it("has the tab title", () => {
    expect(metadata.title).toBe("Chores · Shared Household Chores");
  });

  it("redirects a signed-out visitor to /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fchores");
    expect(choreFindMany).not.toHaveBeenCalled();
  });

  it("redirects a user with no household to /household/new", async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect(choreFindMany).not.toHaveBeenCalled();
  });

  it("loads the household's pending chores by default in one query, undated last", async () => {
    await html();

    expect(categoryFindMany).toHaveBeenCalledWith({
      where: { householdId: "household_1" },
      select: { id: true, name: true, builtIn: true },
    });
    expect(choreFindMany).toHaveBeenCalledTimes(1);
    expect(choreFindMany).toHaveBeenCalledWith({
      where: { householdId: "household_1", AND: [{ status: "pending" }] },
      include: {
        category: { select: { name: true } },
        assignees: {
          select: {
            userId: true,
            user: {
              select: {
                name: true,
                email: true,
                memberships: { where: { householdId: "household_1" }, select: { id: true } },
              },
            },
          },
        },
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    });
    // The list isn't empty, so there is nothing to count.
    expect(choreCount).not.toHaveBeenCalled();
  });

  it("passes valid filters to the query with the request's now", async () => {
    await html({ status: "all", overdue: "1", category: "cat_kitchen" });

    expect(choreFindMany.mock.calls[0][0].where).toEqual({
      householdId: "household_1",
      AND: [{ status: "pending", dueAt: { lt: NOW } }, { categoryId: "cat_kitchen" }],
    });
  });

  it("ignores another household's category and a wrong-case status", async () => {
    const markup = await html({ status: "Completed", category: "cat_other_household" });

    expect(choreFindMany.mock.calls[0][0].where).toEqual({
      householdId: "household_1",
      AND: [{ status: "pending" }],
    });
    expect(markup).toMatch(/<option value="pending" selected="">Pending<\/option>/);
    expect(markup).toMatch(/<option value="" selected="">All categories<\/option>/);
  });

  it("shows the heading, the New chore link and the filter form", async () => {
    const markup = await html();

    expect(markup).toContain("Household chores");
    expect(markup).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    const form = parse(markup).querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/chores");
    expect(markup).toMatch(/<label[^>]*for="filter-status"[^>]*>Status<\/label>/);
    expect(markup).toMatch(/<label[^>]*for="filter-category"[^>]*>Category<\/label>/);
    const overdue = form.querySelector<HTMLInputElement>('input[name="overdue"]')!;
    expect(overdue.type).toBe("checkbox");
    expect(overdue.value).toBe("1");
    expect(overdue.checked).toBe(false);
    expect(overdue.closest("label")!.textContent).toBe("Overdue only");
    const submit = form.querySelector("button")!;
    expect(submit.getAttribute("type")).toBe("submit");
    expect(submit.textContent).toBe("Apply filters");
    expect(markup).toMatch(/<a[^>]*href="\/chores"[^>]*>Clear filters<\/a>/);
    const statusOptions = [
      ...markup.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g),
    ].map((match) => [match[1], match[2]]);
    expect(statusOptions).toEqual([
      ["pending", "Pending"],
      ["completed", "Completed"],
      ["skipped", "Skipped"],
      ["all", "All"],
      ["", "All categories"],
      ["none", "No category"],
      // sortCategories(): built-ins first, then by name.
      ["cat_bath", "Bathroom"],
      ["cat_kitchen", "Kitchen"],
      ["cat_zz", "Zebra care"],
    ]);
  });

  it("shows the filters in effect", async () => {
    const markup = await html({ status: "skipped", overdue: "1", category: "none" });

    expect(markup).toMatch(/<option value="skipped" selected="">Skipped<\/option>/);
    expect(markup).toMatch(/<option value="none" selected="">No category<\/option>/);
    expect(
      parse(markup).querySelector<HTMLInputElement>('input[name="overdue"]')!.checked,
    ).toBe(true);
  });

  it("renders each chore's row, the undated chore after the dated one", async () => {
    const markup = await html();

    const rows = [...markup.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Take out the bins");
    expect(rows[0]).toContain("Kitchen");
    expect(rows[0]).toContain('<time dateTime="2026-10-22T08:30:00.000Z">22 Oct 2026, 08:30 UTC</time>');
    expect(rows[0]).toContain("Priority: Urgent");
    expect(rows[0]).toContain("Effort: Small");
    expect(rows[0]).toContain("Repeats weekly");
    expect(rows[0]).toContain("Assigned to Alice (you), Bob (former member)");
    expect(rows[0]).toContain(">Pending</span>");
    expect(rows[0]).toContain(">Overdue</span>");
    expect(rows[1]).toContain("Water the plants");
    expect(rows[1]).toContain("No category");
    expect(rows[1]).toContain("No due date");
    expect(rows[1]).toContain("Priority: Medium");
    expect(rows[1]).toContain("Unclaimed");
    expect(rows[1]).not.toContain("Repeats");
    expect(rows[1]).not.toContain("Overdue");
    // The title is plain text, not a link.
    expect(rows.join("")).not.toContain("<a");
  });

  it("says No chores yet. when the household has no chores", async () => {
    choreFindMany.mockResolvedValue([]);
    choreCount.mockResolvedValue(0);

    const markup = await html({ status: "all" });

    expect(choreCount).toHaveBeenCalledWith({ where: { householdId: "household_1" } });
    expect(markup).toContain("No chores yet.");
    expect(markup).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    expect(markup).not.toContain("No chores match these filters.");
    expect(markup).not.toContain("<li");
  });

  it("says No chores match these filters. when nothing matches", async () => {
    choreFindMany.mockResolvedValue([]);
    choreCount.mockResolvedValue(3);

    const markup = await html({ status: "completed", overdue: "1" });

    expect(markup).toContain("No chores match these filters.");
    expect(markup).toMatch(/<a[^>]*href="\/chores\?status=all"[^>]*>Show all chores<\/a>/);
    expect(markup).not.toContain("No chores yet.");
    expect(markup).not.toContain("<li");
  });
});

describe("/chores Complete button", () => {
  const bob = { userId: "user_2", user: { name: "Bob", email: "bob@example.com", memberships: [{ id: "m2" }] } };
  const alice = {
    userId: "user_1",
    user: { name: "Alice", email: "alice@example.com", memberships: [{ id: "membership_1" }] },
  };

  /** The titles of the rows that have a Complete button, in order. */
  async function completable(params: Record<string, string> = {}) {
    const doc = parse(await html(params));
    return [...doc.querySelectorAll("li")]
      .filter((row) => row.querySelector("form"))
      .map((row) => {
        const button = row.querySelector("button")!;
        expect(button.textContent).toBe(`Complete "${row.querySelector("span")!.textContent}"`);
        expect(row.querySelector<HTMLInputElement>('input[name="choreId"]')!.type).toBe("hidden");
        return row.querySelector("span")!.textContent;
      });
  }

  beforeEach(() => {
    choreFindMany.mockResolvedValue([
      chore({ id: "c1", title: "Mine overdue", dueAt: new Date("2026-10-01T00:00:00.000Z"), assignees: [alice] }),
      chore({ id: "c2", title: "Mine not yet due", dueAt: new Date("2026-12-01T00:00:00.000Z"), assignees: [bob, alice] }),
      chore({ id: "c3", title: "Bob's", assignees: [bob] }),
      chore({ id: "c4", title: "Nobody's" }),
      chore({ id: "c5", title: "Unclaimed", assignmentMode: "claim" }),
      chore({ id: "c6", title: "Claimed by me", assignmentMode: "claim", assignees: [alice] }),
      chore({ id: "c7", title: "Claimed by Bob", assignmentMode: "claim", assignees: [bob] }),
      chore({ id: "c8", title: "Done", status: "completed", assignees: [alice] }),
      chore({ id: "c9", title: "Skipped", status: "skipped", assignees: [alice] }),
    ]);
  });

  it("shows only on the viewer's pending assigned or claimed chores, due or not", async () => {
    expect(await completable({ status: "all" })).toEqual([
      "Mine overdue",
      "Mine not yet due",
      "Claimed by me",
    ]);
  });

  it("does not show for an admin on chores they are not assigned to", async () => {
    membershipFindFirst.mockResolvedValue({ ...membership, role: "admin" });
    choreFindMany.mockResolvedValue([
      chore({ id: "c3", title: "Bob's", assignees: [bob] }),
      chore({ id: "c4", title: "Nobody's" }),
      chore({ id: "c5", title: "Unclaimed", assignmentMode: "claim" }),
      chore({ id: "c7", title: "Claimed by Bob", assignmentMode: "claim", assignees: [bob] }),
    ]);

    expect(await completable()).toEqual([]);
  });

  it("does not show on completed or skipped rows", async () => {
    choreFindMany.mockResolvedValue([
      chore({ id: "c8", title: "Done", status: "completed", assignees: [alice] }),
      chore({ id: "c9", title: "Skipped", status: "skipped", assignees: [alice] }),
    ]);

    expect(await completable({ status: "completed" })).toEqual([]);
  });

  it("puts the message regions above the list and above the empty state", async () => {
    let markup = await html();
    expect(markup.indexOf('role="status"')).toBeLessThan(markup.indexOf("<ul"));

    choreFindMany.mockResolvedValue([]);
    markup = await html();
    expect(markup).toContain('<div role="status"></div><div role="alert"></div>');
    expect(markup.indexOf('role="alert"')).toBeLessThan(markup.indexOf("No chores match these filters."));
  });
});

describe("/chores filter form across client-side navigations", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // A client-side navigation renders the new server tree into the same root,
  // so React reconciles it with the DOM the user has been editing.
  async function navigate(params: Record<string, string | string[]>) {
    const tree = await render(params);
    await act(async () => root.render(tree));
  }

  const status = () => container.querySelector<HTMLSelectElement>("#filter-status")!;
  const category = () => container.querySelector<HTMLSelectElement>("#filter-category")!;
  const overdue = () => container.querySelector<HTMLInputElement>('input[name="overdue"]')!;

  function editWithoutApplying() {
    status().value = "skipped";
    category().value = "cat_bath";
    overdue().checked = true;
  }

  it.each([
    ["the default filters", {}],
    ["only invalid values", { status: "Pending", category: "cat_other_household" }],
  ])(
    "resets unapplied edits when Clear filters leads back to the same filters, from %s",
    async (_label, params) => {
      await navigate(params);
      editWithoutApplying();

      // Clear filters goes to /chores, so the effective filters stay the defaults.
      vi.setSystemTime(new Date(NOW.getTime() + 5_000));
      await navigate({});

      expect(status().value).toBe("pending");
      expect(category().value).toBe("");
      expect(overdue().checked).toBe(false);
    },
  );

  it("shows the new filters after Show all chores and after Clear filters from a filtered URL", async () => {
    await navigate({ status: "completed", overdue: "1", category: "cat_kitchen" });
    expect(status().value).toBe("completed");

    vi.setSystemTime(new Date(NOW.getTime() + 5_000));
    await navigate({ status: "all" });
    expect(status().value).toBe("all");
    expect(category().value).toBe("");
    expect(overdue().checked).toBe(false);

    editWithoutApplying();
    vi.setSystemTime(new Date(NOW.getTime() + 10_000));
    await navigate({});
    expect(status().value).toBe("pending");
    expect(category().value).toBe("");
    expect(overdue().checked).toBe(false);
  });
});

describe("/chores outcome message across server re-renders", () => {
  let container: HTMLDivElement;
  let root: Root;
  const alice = {
    userId: "user_1",
    user: { name: "Alice", email: "alice@example.com", memberships: [{ id: "membership_1" }] },
  };
  const mine = chore({ id: "chore_9", title: "Take out bins", assignees: [alice] });

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    completeChore.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderInto(params: Record<string, string> = {}) {
    const tree = await render(params);
    await act(async () => root.render(tree));
  }

  const status = () => container.querySelector('[role="status"]')!;
  const alert = () => container.querySelector('[role="alert"]')!;

  it("keeps the success message when the row leaves, the list empties and the filter form remounts", async () => {
    choreFindMany.mockResolvedValue([mine]);
    await renderInto();
    const filterForm = container.querySelector("form");

    completeChore.mockResolvedValue({ status: "success", message: 'Completed "Take out bins".' });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
    });

    expect(completeChore).toHaveBeenCalledTimes(1);
    const posted = completeChore.mock.calls[0][1];
    expect([...posted.keys()]).toEqual(["choreId"]);
    expect(posted.get("choreId")).toBe("chore_9");
    expect(status().textContent).toBe('Completed "Take out bins".');
    expect(alert().textContent).toBe("");

    // The re-render from the server after revalidation: the row is gone.
    choreFindMany.mockResolvedValue([]);
    vi.setSystemTime(new Date(NOW.getTime() + 5_000));
    await renderInto();

    expect(container.querySelector("form")).not.toBe(filterForm);
    expect(container.textContent).toContain("No chores match these filters.");
    expect(status().textContent).toBe('Completed "Take out bins".');
  });

  it("shows a refusal as an alert, replacing the previous message", async () => {
    choreFindMany.mockResolvedValue([
      mine,
      chore({ id: "chore_8", title: "Hoover", assignees: [alice] }),
    ]);
    await renderInto();

    completeChore.mockResolvedValueOnce({ status: "success", message: 'Completed "Take out bins".' });
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>("li button")[0].click();
    });
    expect(status().textContent).toBe('Completed "Take out bins".');

    completeChore.mockResolvedValueOnce({
      status: "error",
      message: "This chore has already been completed or skipped.",
    });
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>("li button")[1].click();
    });

    expect(status().textContent).toBe("");
    expect(alert().textContent).toBe("This chore has already been completed or skipped.");
  });

  it("reads Completing… and is disabled while the request is in flight", async () => {
    choreFindMany.mockResolvedValue([mine]);
    await renderInto();
    let finish!: (state: ChoreActionState) => void;
    completeChore.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
    });
    const button = container.querySelector<HTMLButtonElement>("li button")!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Completing… "Take out bins"');

    await act(async () => finish({ status: "error", message: "That chore no longer exists." }));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Complete "Take out bins"');
    expect(alert().textContent).toBe("That chore no longer exists.");
  });
});
