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

/** Compact parts: 10 → ["10分"], 60 → ["1時"], 150 → ["2時", "30分"]. */
export function intervalParts(minutes: number): string[] {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const out: string[] = [];
  if (h) out.push(`${h}時`);
  if (m) out.push(`${m}分`);
  return out;
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
