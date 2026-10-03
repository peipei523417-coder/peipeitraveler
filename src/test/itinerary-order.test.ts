import { describe, it, expect } from "vitest";
import type { ItineraryItem } from "@/types/travel";
import {
  sortDayItems,
  legacyCompare,
  timedInsertRank,
  placementRank,
  dragRank,
  rankBetween,
} from "@/lib/itinerary-order";

const mk = (id: string, startTime: string, sortOrder: number): ItineraryItem => ({
  id, startTime, endTime: "", description: id, sortOrder,
});
const names = (items: ItineraryItem[]) => items.map(i => i.id);

// Hybrid day: 11:00 A, X, Y, 12:00 B
const base = () => [mk("A", "11:00", 100), mk("X", "", 200), mk("Y", "", 300), mk("B", "12:00", 400)];

/** Simulate a timed edit/insert in a Hybrid day (same algorithm as DB trigger). */
function retime(items: ItineraryItem[], id: string, time: string) {
  const others = items.filter(i => i.id !== id);
  const rank = timedInsertRank(others, time)!;
  const self = items.find(i => i.id === id) ?? mk(id, time, 0);
  return sortDayItems([...others, { ...self, startTime: time, sortOrder: rank }], true);
}

describe("hybrid ordering", () => {
  it("CASE A: A → 15:00 moves only A", () => {
    expect(names(retime(base(), "A", "15:00"))).toEqual(["X", "Y", "B", "A"]);
  });
  it("CASE B: B → 09:00 moves only B", () => {
    expect(names(retime(base(), "B", "09:00"))).toEqual(["B", "A", "X", "Y"]);
  });
  it("CASE C: new 11:30 C goes right after A", () => {
    expect(names(retime(base(), "C", "11:30"))).toEqual(["A", "C", "X", "Y", "B"]);
  });
  it("CASE D: deleting A leaves X in place", () => {
    const items = [mk("A", "11:00", 100), mk("X", "", 200), mk("B", "12:00", 300)].filter(i => i.id !== "A");
    expect(names(sortDayItems(items, true))).toEqual(["X", "B"]);
  });
  it("untimed can be dropped between timed items with a single rank", () => {
    const items = [mk("A", "11:00", 100), mk("B", "12:00", 200), mk("C", "13:00", 300), mk("Z", "", 400)];
    const order = ["A", "B", "Z", "C"];
    const r = dragRank(items, order, "Z")!;
    expect(r).toBe(250);
    const next = sortDayItems(items.map(i => (i.id === "Z" ? { ...i, sortOrder: r } : i)), true);
    expect(names(next)).toEqual(order);
  });
  it("multiple untimed items in the same interval + reorder among themselves", () => {
    const items = base();
    const order = ["A", "Y", "X", "B"];
    const r = dragRank(items, order, "Y")!;
    const next = sortDayItems(items.map(i => (i.id === "Y" ? { ...i, sortOrder: r } : i)), true);
    expect(names(next)).toEqual(order);
  });
  it("gap exhausted → null (caller re-spaces)", () => {
    expect(rankBetween(100, 101)).toBeNull();
    const items = [mk("A", "11:00", 100), mk("B", "12:00", 101), mk("Z", "", 102)];
    expect(dragRank(items, ["A", "Z", "B"], "Z")).toBeNull();
  });
  it("same-time timed items are deterministic (new one goes after existing)", () => {
    const items = [mk("A", "11:00", 100), mk("B", "11:00", 200)];
    expect(names(retime(items, "C", "11:00"))).toEqual(["A", "B", "C"]);
    const tie = [mk("b", "10:00", 100), mk("a", "10:00", 100)];
    expect(names(sortDayItems(tie, true))).toEqual(["a", "b"]);
    expect(names(sortDayItems([...tie].reverse(), true))).toEqual(["a", "b"]);
  });
  it("untimed insert appends to end; empty day gets 100", () => {
    expect(placementRank(base(), "")).toBe(500);
    expect(placementRank([], "10:00")).toBe(100);
  });
  it("timed before first timed but after leading untimed", () => {
    const items = [mk("X", "", 100), mk("A", "11:00", 200)];
    expect(names(retime(items, "N", "09:00"))).toEqual(["X", "N", "A"]);
  });
});

describe("legacy ordering is unchanged", () => {
  it("timed by time first, untimed by sort_order after, regardless of sort_order of timed", () => {
    const items = [mk("Y", "", 20), mk("B", "12:00", 0), mk("X", "", 10), mk("A", "11:00", 999)];
    expect(names(sortDayItems(items, false))).toEqual(["A", "B", "X", "Y"]);
  });
  it("legacy comparator equals the previous production comparator", () => {
    const old = (a: ItineraryItem, b: ItineraryItem) => {
      const aHas = !!a.startTime, bHas = !!b.startTime;
      if (aHas && bHas) return a.startTime.localeCompare(b.startTime);
      if (aHas) return -1;
      if (bHas) return 1;
      const ao = a.sortOrder ?? 0, bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    };
    const items = [mk("q", "", 0), mk("p", "", 0), mk("c", "09:00", 5), mk("d", "09:00", 1), mk("e", "", 30)];
    expect(names([...items].sort(legacyCompare))).toEqual(names([...items].sort(old)));
  });
});
