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
