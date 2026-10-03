/**
 * Exact commit signatures for recognising this client's own Realtime echoes.
 * Signature = item id + full-precision DB updated_at (never via Date.getTime,
 * which would drop microseconds).
 */

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Normalise a PostgreSQL timestamptz string (PostgREST or Realtime format) to
 * "YYYY-MM-DDTHH:MM:SS.ffffff+00:00" in UTC, preserving all fractional digits.
 * Returns null if the value can't be parsed (caller then treats event as remote).
 */
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = TS_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac = "", tz = "Z"] = m;
  let offsetMin = 0;
  if (tz.toUpperCase() !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0));
  }
  // Whole-second part shifted to UTC (integer seconds only — no precision loss).
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMin * 60_000;
  const base = new Date(utcMs).toISOString().slice(0, 19);
  // Postgres trims trailing zeros; pad to a fixed width so both sources match.
  const fraction = (frac + "000000").slice(0, Math.max(6, frac.length));
  return `${base}.${fraction}+00:00`;
}

export function signatureKey(id: string, updatedAt: unknown): string | null {
  const ts = normalizeTimestamp(updatedAt);
  return id && ts ? `${id}|${ts}` : null;
}

/** Bounded insertion-ordered set (FIFO eviction, no timers). */
export function addBounded(set: Set<string>, key: string, max = 200) {
  set.add(key);
  while (set.size > max) {
    const oldest = set.values().next().value as string;
    set.delete(oldest);
  }
}
