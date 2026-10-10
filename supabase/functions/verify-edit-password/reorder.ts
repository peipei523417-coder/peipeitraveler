/**
 * Pure planning for the guest "reorder-day" action (same-day only).
 * Mirrors src/lib/itinerary-order.ts (RANK_STEP / rankBetween / dragRank) —
 * kept local because edge functions cannot import from src/.
 */
export const RANK_STEP = 100;

export interface DayRow {
  id: string;
  sort_order: number | null;
  start_time: string | null;
}

export type ReorderPlan =
  | { ok: false; status: number; error: string }
  | { ok: true; kind: "single"; itemId: string; sortOrder: number }
  | { ok: true; kind: "respace"; ranks: { id: string; sortOrder: number }[]; markHybrid: boolean };

function rankBetween(prev: number | null, next: number | null): number | null {
  if (prev === null && next === null) return RANK_STEP;
  if (prev === null) return (next as number) - RANK_STEP;
  if (next === null) return prev + RANK_STEP;
  if (next - prev >= 2) return prev + Math.trunc((next - prev) / 2);
  return null;
}

/**
 * rows      = every item currently stored for (project, day)
 * orderedIds = client's final order for that day (must be exactly the same set)
 */
export function planReorder(rows: DayRow[], orderedIds: string[], movedId: string, hybrid: boolean): ReorderPlan {
  if (new Set(orderedIds).size !== orderedIds.length) return { ok: false, status: 400, error: "Duplicate ids" };
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (rows.length !== orderedIds.length || orderedIds.some((id) => !byId.has(id))) {
    return { ok: false, status: 409, error: "STALE_DAY_ORDER" };
  }
  const moved = byId.get(movedId);
  if (!moved) return { ok: false, status: 409, error: "STALE_DAY_ORDER" };
  if (moved.start_time && moved.start_time.trim()) return { ok: false, status: 400, error: "Timed items cannot be dragged" };

  if (hybrid) {
    const idx = orderedIds.indexOf(movedId);
    const prev = idx > 0 ? byId.get(orderedIds[idx - 1])!.sort_order ?? 0 : null;
    const next = idx < orderedIds.length - 1 ? byId.get(orderedIds[idx + 1])!.sort_order ?? 0 : null;
    const rank = prev !== null && next !== null && next <= prev ? null : rankBetween(prev, next);
    if (rank !== null) return { ok: true, kind: "single", itemId: movedId, sortOrder: rank };
  }
  return {
    ok: true,
    kind: "respace",
    ranks: orderedIds.map((id, i) => ({ id, sortOrder: (i + 1) * RANK_STEP })),
    markHybrid: !hybrid,
  };
}
