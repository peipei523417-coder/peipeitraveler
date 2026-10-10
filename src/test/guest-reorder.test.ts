import { describe, it, expect } from "vitest";
import { planReorder } from "../../supabase/functions/verify-edit-password/reorder";

const rows = [
  { id: "a", sort_order: 100, start_time: "09:00" },
  { id: "c", sort_order: 200, start_time: null },
  { id: "b", sort_order: 300, start_time: "10:00" },
];

describe("guest same-day reorder plan", () => {
  it("hybrid day with a free gap updates only the dragged item", () => {
    expect(planReorder(rows, ["a", "b", "c"], "c", true)).toEqual({ ok: true, kind: "single", itemId: "c", sortOrder: 400 });
  });
  it("legacy day re-spaces the whole day and marks it hybrid", () => {
    const p = planReorder(rows, ["c", "a", "b"], "c", false);
    expect(p).toEqual({
      ok: true, kind: "respace", markHybrid: true,
      ranks: [{ id: "c", sortOrder: 100 }, { id: "a", sortOrder: 200 }, { id: "b", sortOrder: 300 }],
    });
  });
  it("rejects ids from another day/project (stale or forged set)", () => {
    expect(planReorder(rows, ["a", "b", "zzz"], "a", true)).toMatchObject({ ok: false, status: 409 });
    expect(planReorder(rows, ["a", "b"], "a", true)).toMatchObject({ ok: false, status: 409 });
  });
  it("timed items cannot be dragged", () => {
    expect(planReorder(rows, ["b", "a", "c"], "b", true)).toMatchObject({ ok: false, status: 400 });
  });
  it("exhausted gap falls back to re-spacing without re-marking", () => {
    const tight = [
      { id: "x", sort_order: 100, start_time: null },
      { id: "y", sort_order: 101, start_time: null },
      { id: "m", sort_order: 500, start_time: null },
    ];
    expect(planReorder(tight, ["x", "m", "y"], "m", true)).toMatchObject({ ok: true, kind: "respace", markHybrid: false });
  });
});
