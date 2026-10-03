import type { ItineraryItem } from "@/types/travel";

/**
 * Itinerary ordering.
 *
 * Legacy day (day number NOT in project.hybridDays): timed items by start_time,
 * then untimed items by sort_order, id. Unchanged from the original behaviour.
 *
 * Hybrid day (day number in project.hybridDays): sort_order is the single
 * display rank for the whole day; ties broken by id. start_time is only used
 * when a timed item is inserted / re-timed / moved in, to choose its rank
 * (mirrors the DB trigger `itinerary_hybrid_rank`).
 */

export const RANK_STEP = 100;

export function isHybridDay(hybridDays: number[] | undefined | null, dayNumber: number): boolean {
  return Array.isArray(hybridDays) && hybridDays.includes(dayNumber);
}

/** Original Production comparator — keep byte-for-byte behaviour. */
export function legacyCompare(a: ItineraryItem, b: ItineraryItem): number {
  const aHas = !!a.startTime;
  const bHas = !!b.startTime;
  if (aHas && bHas) return a.startTime.localeCompare(b.startTime);
  if (aHas) return -1;
  if (bHas) return 1;
  const ao = a.sortOrder ?? 0;
  const bo = b.sortOrder ?? 0;
  if (ao !== bo) return ao - bo;
  return String(a.id).localeCompare(String(b.id));
}

/** Total order: sort_order ASC, id ASC. Always transitive. */
export function hybridCompare(a: ItineraryItem, b: ItineraryItem): number {
  const ao = a.sortOrder ?? 0;
  const bo = b.sortOrder ?? 0;
  if (ao !== bo) return ao - bo;
  const ai = String(a.id);
  const bi = String(b.id);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

export function sortDayItems<T extends ItineraryItem>(items: T[], hybrid: boolean): T[] {
  return [...items].sort(hybrid ? hybridCompare : legacyCompare);
}

/** Rank strictly between prev and next, or null when the integer gap is exhausted. */
export function rankBetween(prev: number | null, next: number | null): number | null {
  if (prev === null && next === null) return RANK_STEP;
  if (prev === null) return (next as number) - RANK_STEP;
  if (next === null) return prev + RANK_STEP;
  if (next - prev >= 2) return prev + Math.trunc((next - prev) / 2);
  return null;
}

export function appendRank(others: ItineraryItem[]): number {
  if (!others.length) return RANK_STEP;
  return Math.max(...others.map(i => i.sortOrder ?? 0)) + RANK_STEP;
}

/**
 * Rank for a timed item placed by time in a Hybrid day.
 * `others` = every OTHER item of the day (any order).
 * Returns null when the gap is exhausted (server re-spaces).
 */
export function timedInsertRank(others: ItineraryItem[], startTime: string): number | null {
  const ranks = (pred: (i: ItineraryItem) => boolean) => others.filter(pred).map(i => i.sortOrder ?? 0);
  const sorted = [...others].sort(hybridCompare);
  const anchors = sorted.filter(i => !!i.startTime && i.startTime <= startTime);
  if (anchors.length) {
    const prev = anchors[anchors.length - 1].sortOrder ?? 0;
    const after = ranks(i => (i.sortOrder ?? 0) > prev);
    return rankBetween(prev, after.length ? Math.min(...after) : null);
  }
  const laterTimed = ranks(i => !!i.startTime && i.startTime > startTime);
  if (!laterTimed.length) return appendRank(others);
  const next = Math.min(...laterTimed);
  const before = ranks(i => (i.sortOrder ?? 0) < next);
  return rankBetween(before.length ? Math.max(...before) : null, next);
}

/** Rank for an item placed by a new insert / day move in a Hybrid day. */
export function placementRank(others: ItineraryItem[], startTime: string | undefined): number | null {
  return startTime ? timedInsertRank(others, startTime) : appendRank(others);
}

/**
 * Rank for an untimed item dropped at `newIndex` of the full ordered day list
 * (`orderedIds` = final order including the dragged item).
 * Returns null when the gap is exhausted → caller re-spaces the whole day.
 */
export function dragRank(items: ItineraryItem[], orderedIds: string[], movedId: string): number | null {
  const byId = new Map(items.map(i => [i.id, i]));
  const idx = orderedIds.indexOf(movedId);
  if (idx < 0) return null;
  const prev = idx > 0 ? byId.get(orderedIds[idx - 1])?.sortOrder ?? null : null;
  const next = idx < orderedIds.length - 1 ? byId.get(orderedIds[idx + 1])?.sortOrder ?? null : null;
  if (prev !== null && next !== null && next <= prev) return null;
  return rankBetween(prev, next);
}
