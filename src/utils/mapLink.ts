/**
 * Shared helpers for handling pasted map links (Google Maps / 高德地圖 / Naver Map).
 *
 * Goals:
 *   - Naver / Amap "Share" actions often copy a block of text that includes the
 *     place name, address, newlines, AND the share URL. We must store ONLY the
 *     pure https URL — never the surrounding Chinese/Korean text.
 *   - Sanitize to supported map https URLs only to avoid javascript:, data:, file:,
 *     YouTube, Instagram, general websites, etc.
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
    if (detectMapProvider(u.toString()) === "other") return null;
    return u.toString();
  } catch {
    return null;
  }
}

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
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  if (/^maps\.google\.[a-z.]+$/i.test(host)) return "google";
  if (/^maps\.app\.goo\.gl$/i.test(host)) return "google";
  if (/^goo\.gl$/i.test(host) && /^\/maps(\/|$)/i.test(path)) return "google";
  if (/^(?:[a-z0-9-]+\.)?google\.[a-z.]+$/i.test(host) && /^\/maps(\/|$)/i.test(path)) {
    return "google";
  }
  if (/^(m\.)?map\.naver\.com$/i.test(host)) return "naver";
  if (/^naver\.me$/i.test(host)) return "naver";
  if (/^(www\.|ditu\.|uri\.|surl\.)?amap\.com$/i.test(host)) return "amap";
  if (/^(www\.)?gaode\.com$/i.test(host)) return "amap";
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
