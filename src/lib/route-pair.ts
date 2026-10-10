/**
 * A → B helpers for the itinerary bracket overlay.
 * - Pairs adjacent TIMED items in the existing display order (untimed items are skipped).
 * - Interval = difference of start times (not travel time).
 * - Route URL only when both ends are Google Maps links with a reliably
 *   extractable place (coordinates from !3d!4d, /place/<name>, or q/query param).
 *   Naver / Amap / short links / mixed providers → no route (null).
 */
import { detectMapProvider, sanitizeMapUrl } from "@/utils/mapLink";

export interface TimedLike {
  id: string;
  startTime?: string;
  googleMapsUrl?: string;
}

export function parseHHMM(t?: string): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface TimedPair {
  fromId: string;
  toId: string;
  minutes: number;
}

/** Adjacent timed pairs; pairs with zero/negative/invalid gaps are dropped. */
export function buildTimedPairs(ordered: TimedLike[]): TimedPair[] {
  const timed = ordered.filter((i) => parseHHMM(i.startTime) !== null);
  const out: TimedPair[] = [];
  for (let k = 0; k + 1 < timed.length; k++) {
    const a = parseHHMM(timed[k].startTime)!;
    const b = parseHHMM(timed[k + 1].startTime)!;
    const diff = b - a;
    if (diff > 0) out.push({ fromId: timed[k].id, toId: timed[k + 1].id, minutes: diff });
  }
  return out;
}

export interface IntervalUnits {
  hour: (n: number) => string;
  min: (n: number) => string;
}
const ZH_UNITS: IntervalUnits = { hour: (n) => `${n}時`, min: (n) => `${n}分` };

/** Compact parts: 10 → ["10分"], 60 → ["1時"], 150 → ["2時", "30分"]. Units are localizable. */
export function intervalParts(minutes: number, units: IntervalUnits = ZH_UNITS): string[] {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const out: string[] = [];
  if (h) out.push(units.hour(h));
  if (m) out.push(units.min(m));
  return out;
}

/** Gap kept between two brackets that meet at the same timed row (px, split across both). */
export const BRACKET_JUNCTION_GAP = 7;

/**
 * Trim bracket ends that touch a neighbour sharing the same row, so A→B and B→D
 * never look like one continuous line. Input/Output: [{top, height}] in display order.
 */
export function separateBrackets<T extends { top: number; height: number }>(
  geo: T[],
  gap: number = BRACKET_JUNCTION_GAP,
): T[] {
  const half = gap / 2;
  return geo.map((g, i) => {
    const prev = geo[i - 1];
    const next = geo[i + 1];
    const end = g.top + g.height;
    const trimTop = prev && Math.abs(prev.top + prev.height - g.top) < 1 ? half : 0;
    const trimBottom = next && Math.abs(next.top - end) < 1 ? half : 0;
    return { ...g, top: g.top + trimTop, height: Math.max(0, g.height - trimTop - trimBottom) };
  });
}

export function formatInterval(minutes: number): string {
  return intervalParts(minutes).join("");
}

const LATLNG = /^-?\d{1,2}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/;

/** Reliable Google place reference (coords "lat,lng" or a place text) or null. */
export function googlePlaceRef(raw?: string | null): string | null {
  const url = sanitizeMapUrl(raw);
  if (!url || detectMapProvider(url) !== "google") return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  // Short links can't be resolved client-side.
  if (/goo\.gl$/i.test(u.hostname)) return null;
  const full = u.pathname + u.search;
  const d = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(full);
  if (d) return `${d[1]},${d[2]}`;
  const place = /\/maps\/place\/([^/@?]+)/.exec(u.pathname);
  if (place) {
    const name = decodeURIComponent(place[1].replace(/\+/g, " ")).trim();
    if (name) return name;
  }
  for (const key of ["query", "q", "destination"]) {
    const v = u.searchParams.get(key)?.trim();
    if (v) return LATLNG.test(v) ? v.replace(/\s/g, "") : v;
  }
  return null;
}

export function buildRouteUrl(aUrl?: string | null, bUrl?: string | null): string | null {
  const a = googlePlaceRef(aUrl);
  const b = googlePlaceRef(bUrl);
  if (!a || !b) return null;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(a)}&destination=${encodeURIComponent(b)}`;
}
