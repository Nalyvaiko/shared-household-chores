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

// The rows' forms post to these; the actions have their own tests.
type RowAction = (prev: ChoreActionState, formData: FormData) => Promise<ChoreActionState>;
const completeChore = vi.fn<RowAction>();
const skipChore = vi.fn<RowAction>();
const claimChore = vi.fn<RowAction>();
const releaseChore = vi.fn<RowAction>();
vi.mock("@/app/chores/actions", () => ({ completeChore, skipChore, claimChore, releaseChore }));

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
    // The title is plain text, not a link; the only links are the Edit ones.
    expect(rows.join("").match(/<a [^>]*>/g)!.map((a) => a.match(/href="([^"]*)"/)![1])).toEqual([
      "/chores/chore_1/edit",
      "/chores/chore_2/edit",
    ]);
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
    return [...doc.querySelectorAll("li")].flatMap((row) => {
      const button = [...row.querySelectorAll("button")].find((b) => b.textContent!.startsWith("Complete"));
      if (!button) return [];
      expect(button.textContent).toBe(`Complete "${row.querySelector("span")!.textContent}"`);
      expect(button.closest("form")!.querySelector<HTMLInputElement>('input[name="choreId"]')!.type).toBe("hidden");
      return [row.querySelector("span")!.textContent];
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

describe("/chores Skip disclosure", () => {
  const bob = { userId: "user_2", user: { name: "Bob", email: "bob@example.com", memberships: [{ id: "m2" }] } };
  const alice = {
    userId: "user_1",
    user: { name: "Alice", email: "alice@example.com", memberships: [{ id: "membership_1" }] },
  };
  const formerMember = {
    userId: "user_9",
    user: { name: "Carol", email: "carol@example.com", memberships: [] },
  };
  const note = "This chore repeats. Skipping it ends the series: no next occurrence will be created.";

  /** Each row's title with the labels of its controls, in order. */
  async function controls(params: Record<string, string> = {}) {
    const doc = parse(await html(params));
    return [...doc.querySelectorAll("li")].map((row) => {
      // The actions slot is the row's last part, when there is one.
      const slot = row.lastElementChild!.querySelector("form, details, a") ? row.lastElementChild! : null;
      const labels = [...(slot?.children ?? [])].map((control) =>
        control.tagName === "DETAILS"
          ? control.querySelector("summary")!.textContent
          : control.tagName === "A"
            ? control.textContent
            : control.querySelector("button")!.textContent,
      );
      return [row.querySelector("span")!.textContent, labels];
    });
  }

  beforeEach(() => {
    choreFindMany.mockResolvedValue([
      chore({ id: "c1", title: "Mine", assignees: [alice] }),
      chore({ id: "c2", title: "Bob's", assignees: [bob] }),
      chore({ id: "c3", title: "Nobody's" }),
      chore({ id: "c4", title: "Unclaimed", assignmentMode: "claim" }),
      chore({ id: "c5", title: "Claimed by Bob", assignmentMode: "claim", assignees: [bob] }),
      chore({ id: "c6", title: "Carol's", assignees: [formerMember] }),
      chore({ id: "c7", title: "Done", status: "completed", assignees: [alice] }),
      chore({ id: "c8", title: "Skipped", status: "skipped", assignees: [alice] }),
    ]);
  });

  it("is on every pending row for a member, after Complete or alone, and on no other row", async () => {
    expect(await controls({ status: "all" })).toEqual([
      ["Mine", ['Complete "Mine"', 'Skip "Mine"', 'Edit "Mine"']],
      ["Bob's", ['Skip "Bob\'s"', 'Edit "Bob\'s"']],
      ["Nobody's", ['Skip "Nobody\'s"', 'Edit "Nobody\'s"']],
      ["Unclaimed", ['Claim "Unclaimed"', 'Skip "Unclaimed"', 'Edit "Unclaimed"']],
      ["Claimed by Bob", ['Skip "Claimed by Bob"', 'Edit "Claimed by Bob"']],
      ["Carol's", ['Skip "Carol\'s"', 'Edit "Carol\'s"']],
      ["Done", []],
      ["Skipped", []],
    ]);
  });

  it("is on every pending row for an admin too", async () => {
    membershipFindFirst.mockResolvedValue({ ...membership, role: "admin" });

    const rows = await controls({ status: "all" });
    const withSkip = rows.filter(([, labels]) => (labels as string[]).some((l) => l.startsWith("Skip")));
    expect(withSkip).toHaveLength(6);
  });

  it("has no controls at all on completed and skipped rows", async () => {
    choreFindMany.mockResolvedValue([
      chore({ id: "c7", title: "Done", status: "completed", assignees: [alice] }),
      chore({ id: "c8", title: "Skipped", status: "skipped", assignees: [alice] }),
    ]);
    const doc = parse(await html({ status: "all" }));

    for (const row of doc.querySelectorAll("li")) {
      expect(row.querySelector("details")).toBeNull();
      expect(row.querySelector("form")).toBeNull();
      expect(row.querySelector("button")).toBeNull();
    }
    expect(doc.querySelectorAll("li")[1].textContent).toContain("Skipped");
  });

  it("holds a labelled, required reason with no maxLength and a named submit", async () => {
    const doc = parse(await html());
    const details = doc.querySelector<HTMLDetailsElement>("li details")!;

    expect(details.open).toBe(false);
    const form = details.querySelector("form")!;
    expect(form.querySelector<HTMLInputElement>('input[name="choreId"]')!.value).toBe("c1");
    expect(form.querySelector<HTMLInputElement>('input[name="choreId"]')!.type).toBe("hidden");
    const textarea = form.querySelector("textarea")!;
    expect(textarea.id).toBe("skip-reason-c1");
    expect(textarea.name).toBe("reason");
    expect(textarea.required).toBe(true);
    expect(textarea.hasAttribute("maxlength")).toBe(false);
    expect(form.querySelector('label[for="skip-reason-c1"]')!.textContent).toBe("Reason for skipping");
    expect(form.querySelector("button")!.textContent).toBe('Skip chore "Mine"');
    expect(form.querySelector("button")!.disabled).toBe(false);
    // Every row's reason field has its own id.
    const ids = [...doc.querySelectorAll("textarea")].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows the repeats note only for a recurring chore", async () => {
    choreFindMany.mockResolvedValue([
      chore({ id: "c1", title: "Daily", recurrence: "daily" }),
      chore({ id: "c2", title: "Monthly", recurrence: "monthly" }),
      chore({ id: "c3", title: "Once" }),
    ]);
    const forms = [...parse(await html()).querySelectorAll("details form")];

    expect(forms.map((form) => form.textContent!.includes(note))).toEqual([true, true, false]);
  });
});

describe("/chores Claim and Release buttons", () => {
  const alice = {
    userId: "user_1",
    user: { name: "Alice", email: "alice@example.com", memberships: [{ id: "membership_1" }] },
  };
  const bob = { userId: "user_2", user: { name: "Bob", email: "bob@example.com", memberships: [{ id: "m2" }] } };
  const formerBob = { userId: "user_9", user: { name: "Bob", email: "bob@example.com", memberships: [] } };

  /** Each row's title, assignee line and the labels of its controls, in order. */
  async function rows(params: Record<string, string> = { status: "all" }) {
    const doc = parse(await html(params));
    return [...doc.querySelectorAll("li")].map((row) => {
      const slot = row.lastElementChild!.querySelector("form, details, a") ? row.lastElementChild! : null;
      const labels = [...(slot?.children ?? [])].map((control) =>
        control.tagName === "DETAILS"
          ? control.querySelector("summary")!.textContent
          : control.tagName === "A"
            ? control.textContent
            : control.querySelector("button")!.textContent,
      );
      return [row.querySelector("span")!.textContent, labels];
    });
  }

  const claimRows = [
    chore({ id: "c1", title: "Unclaimed", assignmentMode: "claim" }),
    chore({ id: "c2", title: "Former Bob's", assignmentMode: "claim", assignees: [formerBob] }),
    chore({ id: "c3", title: "Mine", assignmentMode: "claim", assignees: [alice] }),
    chore({ id: "c4", title: "Bob's", assignmentMode: "claim", assignees: [bob] }),
    chore({ id: "c5", title: "Bob's and former", assignmentMode: "claim", assignees: [formerBob, bob] }),
    chore({ id: "c6", title: "Bob's and mine", assignmentMode: "claim", assignees: [bob, alice] }),
    chore({ id: "c7", title: "Fixed mine", assignees: [alice] }),
    chore({ id: "c8", title: "Fixed nobody's" }),
    chore({ id: "c9", title: "Claimed done", status: "completed", assignmentMode: "claim", assignees: [alice] }),
    chore({ id: "c10", title: "Unclaimed skipped", status: "skipped", assignmentMode: "claim" }),
  ];

  beforeEach(() => {
    choreFindMany.mockResolvedValue(claimRows);
  });

  it.each(["member", "admin"])(
    "shows Claim only on claimable rows and Release only to a holder, Complete, Release, Skip in order (%s)",
    async (role) => {
      membershipFindFirst.mockResolvedValue({ ...membership, role });

      expect(await rows()).toEqual([
        ["Unclaimed", ['Claim "Unclaimed"', 'Skip "Unclaimed"', 'Edit "Unclaimed"']],
        ["Former Bob's", ['Claim "Former Bob\'s"', 'Skip "Former Bob\'s"', 'Edit "Former Bob\'s"']],
        ["Mine", ['Complete "Mine"', 'Release "Mine"', 'Skip "Mine"', 'Edit "Mine"']],
        ["Bob's", ['Skip "Bob\'s"', 'Edit "Bob\'s"']],
        ["Bob's and former", ['Skip "Bob\'s and former"', 'Edit "Bob\'s and former"']],
        ["Bob's and mine", ['Complete "Bob\'s and mine"', 'Release "Bob\'s and mine"', 'Skip "Bob\'s and mine"', 'Edit "Bob\'s and mine"']],
        ["Fixed mine", ['Complete "Fixed mine"', 'Skip "Fixed mine"', 'Edit "Fixed mine"']],
        ["Fixed nobody's", ['Skip "Fixed nobody\'s"', 'Edit "Fixed nobody\'s"']],
        // Only an admin gets Delete on a finished row.
        ["Claimed done", role === "admin" ? ['Delete "Claimed done"'] : []],
        ["Unclaimed skipped", role === "admin" ? ['Delete "Unclaimed skipped"'] : []],
      ]);
    },
  );

  it("shows the former member's claim on a claimable row", async () => {
    const doc = parse(await html());
    const row = [...doc.querySelectorAll("li")][1];
    expect(row.textContent).toContain("Claimed by Bob (former member)");
  });

  it("renders single-button forms posting a hidden choreId, Claim default and Release outline", async () => {
    const doc = parse(await html());
    const byLabel = (label: string) =>
      [...doc.querySelectorAll("li form button")].find((b) => b.textContent === label)!;

    for (const [label, choreId, variant] of [
      ['Claim "Unclaimed"', "c1", "default"],
      ['Release "Mine"', "c3", "outline"],
    ]) {
      const button = byLabel(label);
      expect(button.getAttribute("type")).toBe("submit");
      expect(button.getAttribute("data-variant")).toBe(variant);
      expect(button.getAttribute("data-size")).toBe("sm");
      expect(button.querySelector(".sr-only")!.textContent).toBe(` "${label.split('"')[1]}"`);
      const form = button.closest("form")!;
      expect(form.querySelectorAll("button")).toHaveLength(1);
      const inputs = form.querySelectorAll("input");
      expect(inputs).toHaveLength(1);
      expect(inputs[0].type).toBe("hidden");
      expect(inputs[0].name).toBe("choreId");
      expect(inputs[0].value).toBe(choreId);
    }
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
  const completeButtons = () =>
    [...container.querySelectorAll<HTMLButtonElement>("li button")].filter((b) =>
      b.textContent!.startsWith("Complet"),
    );

  it("keeps the success message when the row leaves, the list empties and the filter form remounts", async () => {
    choreFindMany.mockResolvedValue([mine]);
    await renderInto();
    const filterForm = container.querySelector("form");

    completeChore.mockResolvedValue({ status: "success", message: 'Completed "Take out bins".' });
    await act(async () => {
      completeButtons()[0].click();
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
      completeButtons()[0].click();
    });
    expect(status().textContent).toBe('Completed "Take out bins".');

    completeChore.mockResolvedValueOnce({
      status: "error",
      message: "This chore has already been completed or skipped.",
    });
    await act(async () => {
      completeButtons()[1].click();
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
      completeButtons()[0].click();
    });
    const button = completeButtons()[0];
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Completing… "Take out bins"');

    await act(async () => finish({ status: "error", message: "That chore no longer exists." }));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Complete "Take out bins"');
    expect(alert().textContent).toBe("That chore no longer exists.");
  });

  describe("with Skip", () => {
    const hoover = chore({ id: "chore_8", title: "Hoover" });
    const rowOf = (choreId: string) =>
      container.querySelector<HTMLTextAreaElement>(`#skip-reason-${choreId}`)!.closest("li")!;
    const detailsOf = (choreId: string) => rowOf(choreId).querySelector("details")!;
    const reasonOf = (choreId: string) =>
      container.querySelector<HTMLTextAreaElement>(`#skip-reason-${choreId}`)!;
    const skipButtonOf = (choreId: string) =>
      detailsOf(choreId).querySelector<HTMLButtonElement>("form button")!;

    async function submitSkip(choreId: string, reason: string) {
      detailsOf(choreId).open = true;
      reasonOf(choreId).value = reason;
      await act(async () => {
        skipButtonOf(choreId).click();
      });
    }

    beforeEach(() => {
      skipChore.mockReset();
      choreFindMany.mockResolvedValue([mine, hoover]);
    });

    it("posts only the chore id and the reason", async () => {
      await renderInto();
      skipChore.mockResolvedValue({ status: "success", message: 'Skipped "Hoover".' });

      await submitSkip("chore_8", "Away\nall week");

      const posted = skipChore.mock.calls[0][1];
      expect([...posted.keys()]).toEqual(["choreId", "reason"]);
      expect(posted.get("choreId")).toBe("chore_8");
      expect(posted.get("reason")).toBe("Away\nall week");
      expect(status().textContent).toBe('Skipped "Hoover".');
    });

    it("reopens only the refused row, with the reason as submitted, also after the server re-render", async () => {
      await renderInto();
      detailsOf("chore_9").open = true;
      const submitted = "  \n  ";
      skipChore.mockResolvedValue({
        status: "error",
        message: "Enter a reason for skipping.",
        skipDraft: { choreId: "chore_8", reason: submitted },
      });

      await submitSkip("chore_8", submitted);

      expect(alert().textContent).toBe("Enter a reason for skipping.");
      expect(status().textContent).toBe("");
      expect(detailsOf("chore_8").open).toBe(true);
      expect(reasonOf("chore_8").value).toBe(submitted);
      // The other row is left as the user had it, and opens no draft.
      expect(reasonOf("chore_9").value).toBe("");

      // The re-render after revalidation keeps the draft.
      vi.setSystemTime(new Date(NOW.getTime() + 5_000));
      await renderInto();
      expect(detailsOf("chore_8").open).toBe(true);
      expect(reasonOf("chore_8").value).toBe(submitted);
    });

    it("reopens the row again after a second refusal of the same text", async () => {
      await renderInto();
      const tooLong = "x".repeat(501);
      // A fresh object each time, as from the server.
      skipChore.mockImplementation(async () => ({
        status: "error",
        message: "Skip reason must be at most 500 characters.",
        skipDraft: { choreId: "chore_8", reason: tooLong },
      }));

      await submitSkip("chore_8", tooLong);
      const first = alert().firstElementChild;
      detailsOf("chore_8").open = false;
      await submitSkip("chore_8", tooLong);

      // A new node, so the identical message is announced again.
      expect(alert().firstElementChild).not.toBe(first);
      expect(alert().textContent).toBe("Skip reason must be at most 500 characters.");
      expect(detailsOf("chore_8").open).toBe(true);
      expect(reasonOf("chore_8").value).toBe(tooLong);
    });

    it("shows only the newest outcome: Skip replaces Complete and Complete replaces Skip", async () => {
      await renderInto();

      completeChore.mockResolvedValueOnce({ status: "success", message: 'Completed "Take out bins".' });
      await act(async () => {
        completeButtons()[0].click();
      });
      expect(status().textContent).toBe('Completed "Take out bins".');

      skipChore.mockResolvedValueOnce({ status: "success", message: 'Skipped "Hoover".' });
      await submitSkip("chore_8", "Away");
      expect(status().textContent).toBe('Skipped "Hoover".');
      expect(alert().textContent).toBe("");

      skipChore.mockResolvedValueOnce({
        status: "error",
        message: "Skip reason can't contain control characters.",
        skipDraft: { choreId: "chore_8", reason: "a\tb" },
      });
      await submitSkip("chore_8", "a\tb");
      expect(status().textContent).toBe("");
      expect(alert().textContent).toBe("Skip reason can't contain control characters.");
      expect(detailsOf("chore_8").open).toBe(true);

      completeChore.mockResolvedValueOnce({ status: "success", message: 'Completed "Take out bins".' });
      await act(async () => {
        completeButtons()[0].click();
      });
      expect(status().textContent).toBe('Completed "Take out bins".');
      expect(alert().textContent).toBe("");
      // The draft belonged to the replaced outcome, so the row closes again.
      expect(detailsOf("chore_8").open).toBe(false);
      expect(reasonOf("chore_8").value).toBe("");
    });

    it("reads Skipping… and is disabled only in the submitting row", async () => {
      await renderInto();
      let finish!: (state: ChoreActionState) => void;
      skipChore.mockReturnValue(new Promise((resolve) => (finish = resolve)));

      await submitSkip("chore_8", "Away");
      expect(skipButtonOf("chore_8").disabled).toBe(true);
      expect(skipButtonOf("chore_8").textContent).toBe('Skipping… "Hoover"');
      expect(skipButtonOf("chore_9").disabled).toBe(false);
      expect(skipButtonOf("chore_9").textContent).toBe('Skip chore "Take out bins"');
      expect(completeButtons()[0].disabled).toBe(false);

      await act(async () => finish({ status: "error", message: "That chore no longer exists." }));
      expect(skipButtonOf("chore_8").disabled).toBe(false);
      expect(skipButtonOf("chore_8").textContent).toBe('Skip chore "Hoover"');
      expect(alert().textContent).toBe("That chore no longer exists.");
    });
  });

  describe("with Claim and Release", () => {
    const unclaimed = chore({ id: "chore_7", title: "Water plants", assignmentMode: "claim" });
    const claimedByMe = chore({ id: "chore_6", title: "Mop floor", assignmentMode: "claim", assignees: [alice] });
    const reasonOf = (choreId: string) =>
      container.querySelector<HTMLTextAreaElement>(`#skip-reason-${choreId}`)!;
    const detailsOf = (choreId: string) => reasonOf(choreId).closest("details")!;
    const skipButtonOf = (choreId: string) =>
      detailsOf(choreId).querySelector<HTMLButtonElement>("form button")!;
    const buttonNamed = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>("li button")].find((b) => b.textContent === label);
    const click = async (label: string) => {
      await act(async () => {
        buttonNamed(label)!.click();
      });
    };

    beforeEach(() => {
      claimChore.mockReset();
      releaseChore.mockReset();
      skipChore.mockReset();
      choreFindMany.mockResolvedValue([mine, unclaimed, claimedByMe]);
    });

    it("posts only the chore id, and the row reflects the claim after the server re-render", async () => {
      await renderInto();
      claimChore.mockResolvedValue({ status: "success", message: 'Claimed "Water plants".' });

      await click('Claim "Water plants"');

      const posted = claimChore.mock.calls[0][1];
      expect([...posted.keys()]).toEqual(["choreId"]);
      expect(posted.get("choreId")).toBe("chore_7");
      expect(status().textContent).toBe('Claimed "Water plants".');

      choreFindMany.mockResolvedValue([mine, { ...unclaimed, assignees: [alice] }, claimedByMe]);
      vi.setSystemTime(new Date(NOW.getTime() + 5_000));
      await renderInto();
      expect(buttonNamed('Claim "Water plants"')).toBeUndefined();
      expect(buttonNamed('Complete "Water plants"')).toBeDefined();
      expect(buttonNamed('Release "Water plants"')).toBeDefined();
      expect(status().textContent).toBe('Claimed "Water plants".');
    });

    it("reads Claiming… / Releasing… and is disabled only in the submitting row", async () => {
      await renderInto();
      let finishClaim!: (state: ChoreActionState) => void;
      claimChore.mockReturnValue(new Promise((resolve) => (finishClaim = resolve)));

      await click('Claim "Water plants"');
      const claim = buttonNamed('Claiming… "Water plants"')!;
      expect(claim.disabled).toBe(true);
      expect(buttonNamed('Release "Mop floor"')!.disabled).toBe(false);
      expect(buttonNamed('Complete "Mop floor"')!.disabled).toBe(false);
      await act(async () => finishClaim({ status: "error", message: "Someone else has already claimed this chore." }));
      expect(claim.disabled).toBe(false);
      expect(claim.textContent).toBe('Claim "Water plants"');
      expect(alert().textContent).toBe("Someone else has already claimed this chore.");

      let finishRelease!: (state: ChoreActionState) => void;
      releaseChore.mockReturnValue(new Promise((resolve) => (finishRelease = resolve)));
      await click('Release "Mop floor"');
      const release = buttonNamed('Releasing… "Mop floor"')!;
      expect(release.disabled).toBe(true);
      expect(buttonNamed('Claim "Water plants"')!.disabled).toBe(false);
      await act(async () => finishRelease({ status: "success", message: 'Released "Mop floor".' }));
      expect(release.textContent).toBe('Release "Mop floor"');
      expect(status().textContent).toBe('Released "Mop floor".');
      expect(alert().textContent).toBe("");
    });

    it("shows only the newest outcome across Complete, Skip, Claim and Release, announcing a repeat again", async () => {
      await renderInto();

      completeChore.mockResolvedValueOnce({ status: "success", message: 'Completed "Take out bins".' });
      await click('Complete "Take out bins"');
      expect(status().textContent).toBe('Completed "Take out bins".');

      claimChore.mockResolvedValueOnce({ status: "success", message: 'Claimed "Water plants".' });
      await click('Claim "Water plants"');
      expect(status().textContent).toBe('Claimed "Water plants".');

      releaseChore.mockResolvedValueOnce({ status: "error", message: "You haven't claimed this chore." });
      await click('Release "Mop floor"');
      expect(status().textContent).toBe("");
      expect(alert().textContent).toBe("You haven't claimed this chore.");

      skipChore.mockResolvedValueOnce({ status: "success", message: 'Skipped "Mop floor".' });
      detailsOf("chore_6").open = true;
      reasonOf("chore_6").value = "Away";
      await act(async () => {
        skipButtonOf("chore_6").click();
      });
      expect(status().textContent).toBe('Skipped "Mop floor".');
      expect(alert().textContent).toBe("");

      releaseChore.mockResolvedValueOnce({ status: "success", message: 'Released "Mop floor".' });
      await click('Release "Mop floor"');
      expect(status().textContent).toBe('Released "Mop floor".');
      const first = status().firstElementChild;

      releaseChore.mockResolvedValueOnce({ status: "success", message: 'Released "Mop floor".' });
      await click('Release "Mop floor"');
      expect(status().firstElementChild).not.toBe(first);
      expect(status().textContent).toBe('Released "Mop floor".');
    });

    it.each([
      ["Claim", 'Claim "Water plants"', claimChore, 'Claimed "Water plants".'],
      ["Release", 'Release "Mop floor"', releaseChore, 'Released "Mop floor".'],
    ])("closes a reopened Skip draft when a %s outcome arrives", async (_label, button, action, message) => {
      await renderInto();
      skipChore.mockResolvedValue({
        status: "error",
        message: "Enter a reason for skipping.",
        skipDraft: { choreId: "chore_9", reason: "  " },
      });
      detailsOf("chore_9").open = true;
      reasonOf("chore_9").value = "  ";
      await act(async () => {
        skipButtonOf("chore_9").click();
      });
      expect(detailsOf("chore_9").open).toBe(true);

      action.mockResolvedValueOnce({ status: "success", message });
      await click(button);

      expect(status().textContent).toBe(message);
      expect(alert().textContent).toBe("");
      expect(detailsOf("chore_9").open).toBe(false);
      expect(reasonOf("chore_9").value).toBe("");
    });
  });
});

describe("/chores Edit and Delete links", () => {
  const mixed = [
    chore({ id: "c1", title: "Pending one" }),
    chore({ id: "c2", title: "Done one", status: "completed" }),
    chore({ id: "c3", title: "Skipped one", status: "skipped" }),
  ];

  function links(doc: Document) {
    return [...doc.querySelectorAll("li a")].map((a) => [a.textContent, a.getAttribute("href")]);
  }

  beforeEach(() => {
    choreFindMany.mockResolvedValue(mixed);
  });

  it("gives a member Edit on pending rows only, as a plain link", async () => {
    const doc = parse(await html({ status: "all" }));

    expect(links(doc)).toEqual([['Edit "Pending one"', "/chores/c1/edit"]]);
    expect(doc.querySelector("li a .sr-only")!.textContent).toBe(' "Pending one"');
  });

  it("gives an admin Edit on pending rows and Delete on completed and skipped rows", async () => {
    membershipFindFirst.mockResolvedValue({ ...membership, role: "admin" });
    const doc = parse(await html({ status: "all" }));

    expect(links(doc)).toEqual([
      ['Edit "Pending one"', "/chores/c1/edit"],
      ['Delete "Done one"', "/chores/c2/edit"],
      ['Delete "Skipped one"', "/chores/c3/edit"],
    ]);
    // Delete is only a link to the edit page, never a form on the row.
    expect(doc.querySelectorAll("li")[1].querySelector("form, details, button")).toBeNull();
  });
});

describe("/chores notice", () => {
  it.each([
    ["saved", "Changes saved."],
    ["deleted", "Chore deleted."],
  ])("shows the %s notice in a status paragraph above the list", async (notice, text) => {
    const doc = parse(await html({ notice }));

    const paragraph = doc.querySelector('p[role="status"]')!;
    expect(paragraph.textContent).toBe(text);
    // Before the list, and separate from the row actions' message region.
    const list = doc.querySelector("ul")!;
    expect(paragraph.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(doc.querySelector('div[role="status"]')!.textContent).toBe("");
  });

  it.each<Record<string, string | string[]>>([{}, { notice: "other" }, { notice: ["saved", "saved"] }])(
    "shows nothing for a missing or unknown notice (%o)",
    async (params) => {
      const doc = parse(await html(params));
      expect(doc.querySelector('p[role="status"]')).toBeNull();
    },
  );

  it("isn't carried by the filter form or Clear filters", async () => {
    const doc = parse(await html({ notice: "saved" }));
    const form = doc.querySelector('form[method="get"]')!;

    expect(form.querySelector('[name="notice"]')).toBeNull();
    const clear = [...form.querySelectorAll("a")].find((a) => a.textContent === "Clear filters")!;
    expect(clear.getAttribute("href")).toBe("/chores");
  });
});
