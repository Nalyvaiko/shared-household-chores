import { describe, expect, it } from "vitest";

import { DUE_AT_UNCHANGED_MARKER, localToUtcIso, utcIsoToLocal } from "@/lib/chore/due-date";
import { assigneeChanges, canChangeAssignment } from "@/lib/chore/edit";
import {
  DUE_AT_INVALID_ERROR,
  DUE_AT_RANGE_ERROR,
  DUE_AT_TIME_ZONE_ERROR,
  parseEditedDueAt,
  resolveEditedDueAt,
} from "@/lib/chore/validation";

describe("canChangeAssignment", () => {
  const chore = { createdById: "user_1" };

  it("allows the creator and any admin, and no other member", () => {
    expect(canChangeAssignment(chore, { userId: "user_1", role: "member" })).toBe(true);
    expect(canChangeAssignment(chore, { userId: "user_2", role: "admin" })).toBe(true);
    expect(canChangeAssignment(chore, { userId: "user_2", role: "member" })).toBe(false);
  });
});

describe("assigneeChanges", () => {
  const base = { existingIds: ["a", "b", "former"], formerIds: ["former"], tickedIds: ["b", "c"] };

  it("Claim → Claim changes nothing", () => {
    expect(assigneeChanges({ ...base, from: "claim", to: "claim" })).toEqual({
      deleteAll: false,
      deleteIds: [],
      insertIds: [],
    });
  });

  it("Fixed → Claim deletes every row", () => {
    expect(assigneeChanges({ ...base, from: "fixed", to: "claim" })).toEqual({
      deleteAll: true,
      deleteIds: [],
      insertIds: [],
    });
  });

  it("Claim → Fixed deletes every row and inserts each tick once", () => {
    expect(
      assigneeChanges({ ...base, tickedIds: ["b", "c", "c"], from: "claim", to: "fixed" }),
    ).toEqual({ deleteAll: true, deleteIds: [], insertIds: ["b", "c"] });
  });

  it("Fixed → Fixed reconciles current members and keeps former members' rows", () => {
    expect(assigneeChanges({ ...base, from: "fixed", to: "fixed" })).toEqual({
      deleteAll: false,
      deleteIds: ["a"],
      insertIds: ["c"],
    });
  });
});

describe("parseEditedDueAt and resolveEditedDueAt", () => {
  const stored = new Date("2026-11-01T09:30:00.000Z");

  it("keeps the stored date for the unchanged marker with an empty field", () => {
    const edited = parseEditedDueAt(DUE_AT_UNCHANGED_MARKER, "");
    expect(edited).toEqual({ kind: "keep" });
    expect(resolveEditedDueAt(edited, stored)).toEqual({ success: true, dueAt: stored });
    expect(resolveEditedDueAt(edited, null)).toEqual({ success: true, dueAt: null });
  });

  it("refuses the unchanged marker with a typed field", () => {
    expect(parseEditedDueAt(DUE_AT_UNCHANGED_MARKER, "2026-11-01T10:30")).toEqual({
      kind: "error",
      error: DUE_AT_TIME_ZONE_ERROR,
    });
  });

  it("sets an in-range date and clears with an empty value", () => {
    expect(resolveEditedDueAt(parseEditedDueAt("2027-01-01T00:00:00.000Z", "x"), stored)).toEqual({
      success: true,
      dueAt: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(resolveEditedDueAt(parseEditedDueAt("", ""), stored)).toEqual({ success: true, dueAt: null });
  });

  it("accepts an out-of-range instant only when it equals the stored one", () => {
    const late = new Date("2100-02-01T00:00:00.000Z");
    const edited = parseEditedDueAt(late.toISOString(), "2100-02-01T01:00");
    expect(edited).toEqual({ kind: "out-of-range", dueAt: late });
    expect(resolveEditedDueAt(edited, late)).toEqual({ success: true, dueAt: late });
    expect(resolveEditedDueAt(edited, stored)).toEqual({ success: false, error: DUE_AT_RANGE_ERROR });
    expect(resolveEditedDueAt(edited, null)).toEqual({ success: false, error: DUE_AT_RANGE_ERROR });
  });

  it("keeps the create refusals for the markers and garbage", () => {
    expect(parseEditedDueAt("out-of-range", "3000-01-01T00:00")).toEqual({
      kind: "error",
      error: DUE_AT_RANGE_ERROR,
    });
    expect(parseEditedDueAt("invalid", "")).toEqual({ kind: "error", error: DUE_AT_INVALID_ERROR });
    expect(parseEditedDueAt("tomorrow", "x")).toEqual({ kind: "error", error: DUE_AT_INVALID_ERROR });
  });
});

describe("utcIsoToLocal", () => {
  it("gives the datetime-local value of the instant in this zone, to the minute", () => {
    const iso = new Date(2026, 2, 10, 9, 5).toISOString();
    expect(utcIsoToLocal(iso)).toBe("2026-03-10T09:05");
    expect(localToUtcIso(utcIsoToLocal(iso))).toBe(iso);
  });
});
