import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page resolves the household through the real `requireHousehold()` guard,
// so the session and the database are mocked underneath it.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const findUnique = vi.fn();
const findFirst = vi.fn();
const choreFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique },
    membership: { findFirst },
    chore: { findMany: choreFindMany },
  },
}));

// Like the real one, `redirect` throws so rendering stops.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { default: Home } = await import("./page");

const NOW = new Date("2026-10-23T12:00:00.000Z");

const session = { user: { id: "user_1", email: "alice@example.com" }, expires: "2099-01-01" };
const user = { id: "user_1", email: "alice@example.com", name: null };
const membershipRow = {
  id: "membership_1",
  userId: "user_1",
  householdId: "household_1",
  role: "admin",
  household: { id: "household_1", name: "Home" },
};

const me = {
  userId: "user_1",
  user: { name: null, email: "alice@example.com", memberships: [{ id: "membership_1" }] },
};

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
    assignees: [me],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  auth.mockReset().mockResolvedValue(session);
  findUnique.mockReset().mockResolvedValue(user);
  findFirst.mockReset().mockResolvedValue(membershipRow);
  choreFindMany.mockReset().mockResolvedValue([
    chore({
      id: "chore_1",
      title: "Overdue bins",
      dueAt: new Date("2026-10-20T07:00:00.000Z"),
    }),
    chore({
      id: "chore_2",
      title: "Upcoming hoovering",
      dueAt: new Date("2026-10-25T18:15:00.000Z"),
      assignmentMode: "claim",
    }),
    chore({ id: "chore_3", title: "Undated sorting" }),
  ]);
  redirect.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/ page", () => {
  it("redirects a signed-out visitor to plain /signin", async () => {
    auth.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
    expect(choreFindMany).not.toHaveBeenCalled();
  });

  it("redirects a session whose user was deleted to /signin", async () => {
    findUnique.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
  });

  it("redirects a user with no household to /household/new", async () => {
    findFirst.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/household/new");
    expect(choreFindMany).not.toHaveBeenCalled();
  });

  it("loads the caller's pending chores in their household in one query", async () => {
    await Home();

    expect(choreFindMany).toHaveBeenCalledTimes(1);
    expect(choreFindMany).toHaveBeenCalledWith({
      where: {
        householdId: "household_1",
        status: "pending",
        assignees: { some: { userId: "user_1" } },
      },
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
  });

  it("shows My chores with the New chore and All household chores links", async () => {
    const html = renderToStaticMarkup(await Home());

    expect(html).toContain("My chores");
    expect(html).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/chores"[^>]*>All household chores<\/a>/);
    // The only forms are the rows' Complete and Skip forms, and Release on the claim chore.
    expect(html.match(/<form/g)).toHaveLength(7);
    expect(html).not.toContain("Nothing assigned to you right now.");
  });

  it("gives every row a Complete button named after its chore", async () => {
    const html = renderToStaticMarkup(await Home());

    const rows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(rows).toHaveLength(3);
    for (const [index, title] of ["Overdue bins", "Upcoming hoovering", "Undated sorting"].entries()) {
      expect(rows[index]).toContain(`<input type="hidden" name="choreId" value="chore_${index + 1}"/>`);
      expect(rows[index]).toMatch(
        new RegExp(`<button[^>]*type="submit"[^>]*>Complete<span class="sr-only"> &quot;${title}&quot;</span></button>`),
      );
    }
    // The Complete form posts only the chore id.
    const completeForm = rows[0].match(/<form[^>]*>([\s\S]*?)<\/form>/)![1];
    expect(completeForm).toContain(">Complete<");
    expect(completeForm.match(/<input/g)).toHaveLength(1);
  });

  it("gives every row a Skip disclosure after Complete, named after its chore", async () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await Home()), "text/html");

    const rows = [...doc.querySelectorAll("li")];
    expect(rows).toHaveLength(3);
    for (const [index, title] of ["Overdue bins", "Upcoming hoovering", "Undated sorting"].entries()) {
      const row = rows[index];
      const details = row.querySelector("details")!;
      expect(details.open).toBe(false);
      // Complete's form comes before the disclosure in the actions slot.
      const completeForm = row.querySelector("form")!;
      expect(completeForm.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(details.querySelector("summary")!.textContent).toBe(`Skip "${title}"`);

      const form = details.querySelector("form")!;
      const hidden = form.querySelector<HTMLInputElement>('input[name="choreId"]')!;
      expect(hidden.type).toBe("hidden");
      expect(hidden.value).toBe(`chore_${index + 1}`);
      const textarea = form.querySelector("textarea")!;
      expect(textarea.name).toBe("reason");
      expect(textarea.id).toBe(`skip-reason-chore_${index + 1}`);
      expect(textarea.required).toBe(true);
      expect(textarea.hasAttribute("maxlength")).toBe(false);
      expect(textarea.value).toBe("");
      const label = form.querySelector(`label[for="skip-reason-chore_${index + 1}"]`)!;
      expect(label.textContent).toBe("Reason for skipping");
      const submit = form.querySelector("button")!;
      expect(submit.type).toBe("submit");
      expect(submit.disabled).toBe(false);
      expect(submit.textContent).toBe(`Skip chore "${title}"`);
      expect(form.querySelectorAll("button")).toHaveLength(1);
    }
  });

  it("gives Release only on the viewer's claim chores, between Complete and Skip, and never Claim", async () => {
    const bob = { userId: "user_2", user: { name: "Bob", email: "bob@example.com", memberships: [{ id: "m2" }] } };
    const formerBob = { userId: "user_9", user: { name: "Bob", email: "bob@example.com", memberships: [] } };
    choreFindMany.mockResolvedValue([
      chore({ id: "chore_1", title: "Fixed bins" }),
      chore({ id: "chore_2", title: "Claimed hoovering", assignmentMode: "claim" }),
      chore({ id: "chore_3", title: "Shared claim", assignmentMode: "claim", assignees: [bob, me] }),
      chore({ id: "chore_4", title: "Claim with former", assignmentMode: "claim", assignees: [formerBob, me] }),
    ]);
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await Home()), "text/html");

    const controls = [...doc.querySelectorAll("li")].map((row) =>
      [...row.lastElementChild!.children].map((control) =>
        control.tagName === "DETAILS"
          ? control.querySelector("summary")!.textContent
          : control.tagName === "A"
            ? control.textContent
            : control.querySelector("button")!.textContent,
      ),
    );
    expect(controls).toEqual([
      ['Complete "Fixed bins"', 'Skip "Fixed bins"', 'Edit "Fixed bins"'],
      [
        'Complete "Claimed hoovering"',
        'Release "Claimed hoovering"',
        'Skip "Claimed hoovering"',
        'Edit "Claimed hoovering"',
      ],
      ['Complete "Shared claim"', 'Release "Shared claim"', 'Skip "Shared claim"', 'Edit "Shared claim"'],
      [
        'Complete "Claim with former"',
        'Release "Claim with former"',
        'Skip "Claim with former"',
        'Edit "Claim with former"',
      ],
    ]);

    // Edit is a plain link to the edit page, so it works without JavaScript.
    expect([...doc.querySelectorAll("li a")].map((a) => a.getAttribute("href"))).toEqual([
      "/chores/chore_1/edit",
      "/chores/chore_2/edit",
      "/chores/chore_3/edit",
      "/chores/chore_4/edit",
    ]);

    const release = [...doc.querySelectorAll("li button")].find(
      (b) => b.textContent === 'Release "Claimed hoovering"',
    )!;
    expect(release.getAttribute("data-variant")).toBe("outline");
    expect(release.getAttribute("data-size")).toBe("sm");
    expect(release.querySelector(".sr-only")!.textContent).toBe(' "Claimed hoovering"');
    const form = release.closest("form")!;
    expect(form.querySelectorAll("input")).toHaveLength(1);
    expect(form.querySelector<HTMLInputElement>('input[name="choreId"]')!.type).toBe("hidden");
    expect(form.querySelector<HTMLInputElement>('input[name="choreId"]')!.value).toBe("chore_2");
    expect(doc.body.textContent).not.toMatch(/\bClaim "/);
  });

  it("shows the repeats note only in a recurring chore's Skip form", async () => {
    choreFindMany.mockResolvedValue([
      chore({ id: "chore_1", title: "Weekly bins", recurrence: "weekly" }),
      chore({ id: "chore_2", title: "One-off sorting" }),
    ]);
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await Home()), "text/html");

    const note = "This chore repeats. Skipping it ends the series: no next occurrence will be created.";
    const [weekly, oneOff] = [...doc.querySelectorAll("details form")];
    const paragraph = [...weekly.querySelectorAll("p")].find((p) => p.textContent === note)!;
    expect(paragraph).toBeTruthy();
    expect(
      paragraph.compareDocumentPosition(weekly.querySelector("button")!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(oneOff.textContent).not.toContain("This chore repeats.");
  });

  it("renders the message regions above the list, and in the empty state", async () => {
    let html = renderToStaticMarkup(await Home());
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf("<ul"));
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf("<ul"));

    choreFindMany.mockResolvedValue([]);
    html = renderToStaticMarkup(await Home());
    expect(html).toContain('<div role="status"></div><div role="alert"></div>');
    expect(html.indexOf('role="status"')).toBeLessThan(
      html.indexOf("Nothing assigned to you right now."),
    );
  });

  it("renders the rows in query order, the undated chore last", async () => {
    const html = renderToStaticMarkup(await Home());

    const rows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Overdue bins");
    expect(rows[0]).toContain(">Overdue</span>");
    expect(rows[0]).toContain("Assigned to alice@example.com (you)");
    expect(rows[1]).toContain("Upcoming hoovering");
    expect(rows[1]).toContain('<time dateTime="2026-10-25T18:15:00.000Z">25 Oct 2026, 18:15 UTC</time>');
    expect(rows[1]).not.toContain("Overdue");
    expect(rows[1]).toContain("Claimed by alice@example.com (you)");
    expect(rows[2]).toContain("Undated sorting");
    expect(rows[2]).toContain("No due date");
  });

  it("shows the empty state with the All household chores link", async () => {
    choreFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await Home());

    expect(html).toContain("Nothing assigned to you right now.");
    expect(html).toMatch(/<a[^>]*href="\/chores"[^>]*>All household chores<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/chores\/new"[^>]*>New chore<\/a>/);
    expect(html).not.toContain("<li");
  });
});
