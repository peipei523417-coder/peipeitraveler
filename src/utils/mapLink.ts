/**
 * Shared helpers for handling pasted map links (Google Maps / 高德地圖 / Naver Map).
 *
 * Goals:
 *   - Naver / Amap "Share" actions often copy a block of text that includes the
 *     place name, address, newlines, AND the share URL. We must store ONLY the
 *     pure https URL — never the surrounding Chinese/Korean text.
 *   - Sanitize to https-only to avoid javascript:, data:, file:, etc.
 *   - Provide a provider-aware label so UI doesn't hard-code "Google Maps".
 *   - No network calls, no short-link expansion (keeps it fast + reliable).
 */

export type MapProvider = "google" | "amap" | "naver" | "other";

/**
 * Extract the first http(s) URL from a free-form input string. Returns null
 * when no URL is found. Used to pull a clean URL out of pasted "share text".
 */
export function extractFirstUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = String(input);
  // Greedy stop on whitespace / common terminators.
  const match = text.match(/https?:\/\/[^\s<>"'(){}\[\]、，。]+/i);
  return match ? match[0] : null;
}

/**
 * Sanitize a pasted map link:
 *   1. Pull out the first URL if mixed with other text.
 *   2. Trim trailing punctuation that often gets glued on.
 *   3. Allow https:// only. http:// is upgraded to https://. Anything else
 *      (javascript:, data:, file:, mailto:, etc.) returns null.
 *   4. Validates with URL parser.
 */
export function sanitizeMapUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const extracted = extractFirstUrl(input) ?? String(input).trim();
  if (!extracted) return null;

  // Strip trailing punctuation that frequently gets pasted along with URLs.
  let candidate = extracted.replace(/[.,;:!?)\]}>"'`]+$/u, "");

  if (/^http:\/\//i.test(candidate)) candidate = "https://" + candidate.slice(7);
  if (!/^https:\/\//i.test(candidate)) return null;

  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

const GOOGLE_HOSTS = [
  /(^|\.)google\.[a-z.]+$/i,
  /(^|\.)maps\.app\.goo\.gl$/i,
  /(^|\.)goo\.gl$/i,
];

const AMAP_HOSTS = [
  /(^|\.)amap\.com$/i,
  /(^|\.)surl\.amap\.com$/i,
  /(^|\.)gaode\.com$/i,
];

const NAVER_HOSTS = [
  /(^|\.)naver\.com$/i,
  /(^|\.)map\.naver\.com$/i,
  /(^|\.)naver\.me$/i,
];

/**
 * Detect provider from a (possibly pre-sanitized) URL. Falls back to "other"
 * when the URL is unrecognised or invalid.
 */
export function detectMapProvider(url: string | null | undefined): MapProvider {
  if (!url) return "other";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  const host = parsed.host.toLowerCase();
  const path = parsed.pathname;

  if (GOOGLE_HOSTS.some((re) => re.test(host))) {
    // google.com requires /maps path to count; maps.app.goo.gl & goo.gl already pass.
    if (/(^|\.)google\.[a-z.]+$/i.test(host) && !/\/maps(\/|$)/i.test(path)) {
      // Plain google.com without /maps isn't a map link.
      return "other";
    }
    return "google";
  }
  if (AMAP_HOSTS.some((re) => re.test(host))) return "amap";
  if (NAVER_HOSTS.some((re) => re.test(host))) return "naver";
  return "other";
}

/**
 * Human-readable label for the map button / status row.
 */
export function getMapProviderLabel(url: string | null | undefined): string {
  switch (detectMapProvider(url)) {
    case "google":
      return "Google Maps";
    case "amap":
      return "高德地圖";
    case "naver":
      return "Naver Map";
    default:
      return "開啟地圖";
  }
}
