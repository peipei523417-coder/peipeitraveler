/**
 * Map URL helpers — Google Maps, Naver Map, 高德地圖 (Amap).
 *
 * Strategy by provider:
 *
 *   Google Maps  → app-first-with-browser-fallback
 *                  (existing behaviour, unchanged)
 *      1. Native: try Google Maps app via AppLauncher.
 *         If unavailable / fails → Capacitor Browser.open(httpsUrl).
 *         If that fails → window.location.href = httpsUrl.
 *      2. Web: window.open(httpsUrl, "_blank").
 *         If blocked → window.location.href = httpsUrl.
 *
 *   Naver Map / 高德地圖 → browser-only (stability-first, NO app scheme)
 *      1. Native: Capacitor Browser.open(httpsUrl).
 *         If that fails → window.location.href = httpsUrl.
 *      2. Web: window.open(httpsUrl, "_blank"), then window.location fallback.
 *
 * We NEVER derive a Map URL from title/description/location text.
 * Only the user's pasted https URL is opened.
 */

type MapProvider = "google" | "naver" | "amap" | null;

/** Google Maps host/path regex (unchanged from previous behaviour). */
const GOOGLE_MAPS_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;

/**
 * Whitelisted Naver Map hosts (official share URLs only).
 *   - map.naver.com / m.map.naver.com — web share links
 *   - naver.me                        — short links from the Naver Map app's
 *                                       Share → Copy link action
 */
const NAVER_HOSTS = new Set([
  "map.naver.com",
  "m.map.naver.com",
  "naver.me",
]);

/**
 * Whitelisted 高德地圖 (Amap) hosts (official share URLs only).
 *   - amap.com / ditu.amap.com / uri.amap.com — web share links
 *   - surl.amap.com                           — short links from the Amap
 *                                               app's Share → Copy link action
 *   - gaode.com                               — legacy alias
 */
const AMAP_HOSTS = new Set([
  "amap.com",
  "www.amap.com",
  "ditu.amap.com",
  "uri.amap.com",
  "surl.amap.com",
  "gaode.com",
  "www.gaode.com",
]);

function detectProvider(host: string, pathname: string): MapProvider {
  const hostPath = host + pathname;
  if (GOOGLE_MAPS_HOST_RE.test(hostPath) || GOOGLE_MAPS_HOST_RE.test(host)) {
    return "google";
  }
  if (NAVER_HOSTS.has(host)) return "naver";
  if (AMAP_HOSTS.has(host)) return "amap";
  return null;
}

/**
 * Validate + normalize a map URL. Auto-prepends https:// if missing.
 * Returns the normalized https URL, or null if it is not a supported
 * map URL (Google / Naver / Amap).
 */
export function normalizeMapUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url) return null;

  if (!/^https?:\/\//i.test(url)) {
    if (/\s/.test(url) || !url.includes(".")) return null;
    url = "https://" + url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const provider = detectProvider(parsed.host.toLowerCase(), parsed.pathname);
  if (!provider) return null;

  if (parsed.protocol === "http:") parsed.protocol = "https:";
  return parsed.toString();
}

/**
 * Produce a PDF-annotation-safe https URL for a map link.
 *
 * Why this exists:
 *   - PDF /URI annotations must be plain ASCII https URLs. Stray whitespace,
 *     newlines (%0A/%0D), or invisible chars cause iOS Files / Adobe Reader
 *     to refuse the link or pass garbage to the OS handler.
 *   - Google Maps short links (maps.app.goo.gl, goo.gl/maps) clicked from a
 *     PDF often deep-link into the Google Maps app, which then shows
 *     "unsupported link" because the app's deep-link handler resolves the
 *     short URL differently than the in-app browser path used inside the app.
 *
 * Strategy:
 *   1. trim + strip control chars / CR / LF.
 *   2. Re-run sanitizeMapUrl-equivalent (normalizeMapUrl) to enforce https
 *      and a supported provider.
 *   3. For Google Maps short URLs, rewrite to the stable browser format
 *      `https://www.google.com/maps/search/?api=1&query=<placeName>` when
 *      we have a usable place name, so PDF readers always open the link in
 *      a browser → Google search → Maps (which works reliably). If no place
 *      name is available, keep the original long https URL.
 *   4. Naver / Amap are returned as-is (already https; their PDF behaviour
 *      is stable because they open in the in-app browser, not a native app).
 *
 * Never apply encodeURIComponent to the whole URL — it would mangle
 * &, ?, =. We only encode the place-name query parameter value.
 */
export type PdfMapQuerySource =
  | "original-long"
  | "original-short"
  | "latlng"
  | "address"
  | "title"
  | "none";

export interface PdfMapAnnotation {
  /** Final URL safe for PDF /URI annotation (always https://), or null when rejected. */
  url: string | null;
  /** Which strategy produced the URL. */
  querySource: PdfMapQuerySource;
  /** Provider detected from the original URL. */
  provider: MapProvider;
  rejected: boolean;
  rejectReason?: string;
}

/** Extract `lat,lng` from common Google Maps URL patterns. Returns null if none. */
function extractLatLngFromGoogleUrl(parsed: URL): string | null {
  const latLngRe = /(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/;
  // @lat,lng,zoom in pathname.
  const atMatch = parsed.pathname.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (atMatch) return `${atMatch[1]},${atMatch[2]}`;
  // !3dLAT!4dLNG
  const bangMatch = parsed.pathname.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (bangMatch) return `${bangMatch[1]},${bangMatch[2]}`;
  for (const key of ["query", "q", "ll", "destination", "center"]) {
    const v = parsed.searchParams.get(key);
    if (v) {
      const m = v.match(latLngRe);
      if (m) return `${m[1]},${m[2]}`;
    }
  }
  return null;
}

/**
 * Build a PDF-safe annotation URL for a map link.
 *
 * Rules:
 *   - Always clean control chars / CR / LF / zero-width before anything else.
 *   - Only `https://` is allowed in PDF annotations. `intent://`, `geo:`,
 *     `comgooglemaps://`, etc. are rejected outright.
 *   - Google long URLs: keep the original cleaned https URL (don't downgrade
 *     to a search URL — the original carries place id / coords).
 *   - Google short URLs (maps.app.goo.gl, goo.gl/maps): keep original by
 *     default. ONLY rewrite to the stable search format when we have
 *     reliable query data (lat,lng > address > title). Search URLs from a
 *     bare title risk routing to a same-named place elsewhere, so they are
 *     a last resort and we still prefer the original short link when no
 *     reliable query is available.
 *   - Naver / Amap: pass through unchanged. NEVER inject title/description
 *     into Naver/Amap URLs (prior 高德 regression).
 */
export function buildPdfMapAnnotation(
  rawUrl: string | null | undefined,
  opts?: { placeName?: string | null; address?: string | null; latlng?: string | null },
): PdfMapAnnotation {
  if (!rawUrl) {
    return { url: null, querySource: "none", provider: null, rejected: true, rejectReason: "empty" };
  }
  const cleaned = String(rawUrl)
    .replace(/%0A/gi, "")
    .replace(/%0D/gi, "")
    .replace(/&amp;/gi, "&")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, "")
    .trim();
  if (!cleaned) {
    return { url: null, querySource: "none", provider: null, rejected: true, rejectReason: "blank-after-clean" };
  }

  const normalized = normalizeMapUrl(cleaned);
  if (!normalized) {
    return { url: null, querySource: "none", provider: null, rejected: true, rejectReason: "not-supported-provider-or-not-https" };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { url: null, querySource: "none", provider: null, rejected: true, rejectReason: "url-parse-failed" };
  }
  if (parsed.protocol !== "https:") {
    return { url: null, querySource: "none", provider: null, rejected: true, rejectReason: `non-https:${parsed.protocol}` };
  }

  const host = parsed.host.toLowerCase();
  const provider = detectProvider(host, parsed.pathname);

  // Naver / Amap → pass through, NEVER inject text.
  if (provider === "naver" || provider === "amap") {
    return { url: parsed.toString(), querySource: "original-long", provider, rejected: false };
  }

  if (provider !== "google") {
    return { url: null, querySource: "none", provider, rejected: true, rejectReason: "unknown-provider" };
  }

  const isGoogleShort =
    host === "maps.app.goo.gl" || host === "goo.gl" || host.endsWith(".app.goo.gl");

  // Long URL → keep as-is.
  if (!isGoogleShort) {
    return { url: parsed.toString(), querySource: "original-long", provider, rejected: false };
  }

  // Short URL → prefer reliable query (latlng > address > title) when present.
  const ll = (opts?.latlng || "").trim() || extractLatLngFromGoogleUrl(parsed);
  if (ll && /^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$/.test(ll)) {
    return {
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll)}`,
      querySource: "latlng",
      provider,
      rejected: false,
    };
  }
  const addr = (opts?.address || "").trim();
  if (addr && addr.length >= 6) {
    return {
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`,
      querySource: "address",
      provider,
      rejected: false,
    };
  }
  // NOTE: We intentionally do NOT rewrite Google short URLs to a search URL
  // using just the place name/title — that produced "no results" in Google
  // Maps for same-named or differently-localized places. Only latlng or a
  // full address are considered reliable enough to rewrite. Otherwise we
  // keep the original https short URL and let Google's own redirector
  // resolve it.
  return { url: parsed.toString(), querySource: "original-short", provider, rejected: false };
}

/** Back-compat thin wrapper. */
export function toPdfMapUrl(
  rawUrl: string | null | undefined,
  placeName?: string | null,
): string | null {
  return buildPdfMapAnnotation(rawUrl, { placeName }).url;
}

/** Back-compat: only returns a URL when it is specifically a Google Maps URL. */
export function normalizeGoogleMapsUrl(raw: string | undefined | null): string | null {
  const normalized = normalizeMapUrl(raw);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return detectProvider(parsed.host.toLowerCase(), parsed.pathname) === "google"
      ? normalized
      : null;
  } catch {
    return null;
  }
}

/** Back-compat alias. */
export function normalizeMapsUrl(raw: string | undefined | null): string | null {
  return normalizeMapUrl(raw);
}

async function detectPlatform(): Promise<"ios" | "android" | "web"> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const p = Capacitor.getPlatform();
      if (p === "ios" || p === "android") return p;
    }
  } catch {
    /* web */
  }
  return "web";
}

/**
 * Try to open Google Maps native app via deep link.
 * Returns true on success, false if the app is not available or open failed.
 */
async function tryOpenGoogleInApp(
  platform: "ios" | "android",
  normalizedUrl: string,
): Promise<boolean> {
  try {
    const { AppLauncher } = await import("@capacitor/app-launcher");

    let appUrl: string;
    if (platform === "ios") {
      appUrl = `comgooglemaps://?url=${encodeURIComponent(normalizedUrl)}`;
    } else {
      appUrl =
        `intent://${normalizedUrl.replace(/^https?:\/\//, "")}` +
        `#Intent;scheme=https;package=com.google.android.apps.maps;` +
        `S.browser_fallback_url=${encodeURIComponent(normalizedUrl)};end`;
    }

    if (platform === "ios") {
      const { value } = await AppLauncher.canOpenUrl({ url: "comgooglemaps://" });
      if (!value) return false;
    }

    const res = await AppLauncher.openUrl({ url: appUrl });
    return !!res?.completed;
  } catch (e) {
    console.warn("[MAP_OPEN_APP_FAIL]", e);
    return false;
  }
}

async function openInBrowser(normalizedUrl: string): Promise<boolean> {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: normalizedUrl, presentationStyle: "fullscreen" });
    return true;
  } catch (e) {
    console.warn("[MAP_OPEN_BROWSER_FAIL]", e);
    return false;
  }
}

function openInWindowLocation(normalizedUrl: string): boolean {
  try {
    window.location.href = normalizedUrl;
    return true;
  } catch (e) {
    console.error("[MAP_OPEN_LOCATION_FAIL]", e);
    return false;
  }
}

async function openWebFallback(normalizedUrl: string): Promise<boolean> {
  try {
    const w = window.open(normalizedUrl, "_blank", "noopener,noreferrer");
    if (w) return true;
  } catch (e) {
    console.warn("[MAP_OPEN_WINDOW_OPEN_FAIL]", e);
  }
  console.log("[MAP_OPEN_FALLBACK]", {
    reason: "window-open-blocked",
    fallbackUrl: normalizedUrl,
  });
  return openInWindowLocation(normalizedUrl);
}

/**
 * Open a map URL (Google / Naver / Amap). Google uses app-first;
 * Naver and Amap go straight to the in-app browser (no app scheme).
 */
export async function openMapUrl(url: string): Promise<boolean> {
  const normalizedUrl = normalizeMapUrl(url);
  if (!normalizedUrl) {
    console.warn("[MAP_OPEN_INVALID]", { url });
    return false;
  }

  const parsed = new URL(normalizedUrl);
  const provider = detectProvider(parsed.host.toLowerCase(), parsed.pathname);
  const platform = await detectPlatform();

  console.log("[MAP_OPEN_STRATEGY]", {
    provider,
    platform,
    normalizedUrl,
    strategy:
      provider === "google" ? "app-first-with-browser-fallback" : "browser-only",
  });

  // Google Maps keeps its existing app-first flow.
  if (provider === "google" && (platform === "ios" || platform === "android")) {
    const appOk = await tryOpenGoogleInApp(platform, normalizedUrl);
    if (appOk) return true;

    console.log("[MAP_OPEN_FALLBACK]", {
      reason: "app-deep-link-failed-or-unavailable",
      fallbackUrl: normalizedUrl,
    });

    const browserOk = await openInBrowser(normalizedUrl);
    if (browserOk) return true;

    return openInWindowLocation(normalizedUrl);
  }

  // Naver / Amap on native: browser-only.
  if (platform === "ios" || platform === "android") {
    const browserOk = await openInBrowser(normalizedUrl);
    if (browserOk) return true;
    return openInWindowLocation(normalizedUrl);
  }

  // Web (any provider).
  return openWebFallback(normalizedUrl);
}

/** Back-compat alias for existing Google-only callers. */
export async function openGoogleMapsUrl(url: string): Promise<boolean> {
  return openMapUrl(url);
}

// Back-compat shim. Second arg ignored — never derive Map URL from text.
export async function openGoogleMaps(
  originalUrl: string,
  _placeText?: string,
): Promise<void> {
  await openMapUrl(originalUrl);
}

/**
 * Browser-only fallback. Skips any app deep link and opens the normalized
 * https URL in the in-app browser (or window.location on web).
 */
export async function openGoogleMapsInBrowserOnly(url: string): Promise<boolean> {
  const normalizedUrl = normalizeMapUrl(url);
  if (!normalizedUrl) {
    console.warn("[MAP_OPEN_INVALID]", { url });
    return false;
  }
  const platform = await detectPlatform();
  console.log("[MAP_OPEN_BROWSER_ONLY]", { platform, normalizedUrl });

  if (platform === "ios" || platform === "android") {
    const browserOk = await openInBrowser(normalizedUrl);
    if (browserOk) return true;
    return openInWindowLocation(normalizedUrl);
  }

  return openWebFallback(normalizedUrl);
}
