/**
 * Google Maps URL helpers.
 *
 * Open strategy: app-first-with-browser-fallback.
 *   1. Native (iOS/Android): try Google Maps app via AppLauncher
 *      (comgooglemaps:// on iOS, geo:?q=URL / android intent on Android).
 *      If that fails OR the app is not installed, fall back to
 *      Capacitor Browser.open(httpsUrl). If that also fails, fall back
 *      to window.location.href = httpsUrl.
 *   2. Web: window.open(httpsUrl, "_blank"). If blocked/fails, fall
 *      back to window.location.href = httpsUrl.
 *
 * We NEVER derive a Maps URL from title/description/location text. Only
 * the user's pasted https Google Maps URL is opened.
 */

const GOOGLE_MAPS_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;

/**
 * Validate + normalize a Google Maps URL. Auto-prepends https:// if missing.
 * Returns the normalized https URL, or null if it is not a Google Maps URL.
 */
export function normalizeGoogleMapsUrl(raw: string | undefined | null): string | null {
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

  const hostPath = parsed.host + parsed.pathname;
  if (!GOOGLE_MAPS_HOST_RE.test(hostPath) && !GOOGLE_MAPS_HOST_RE.test(parsed.host)) {
    return null;
  }

  if (parsed.protocol === "http:") parsed.protocol = "https:";
  return parsed.toString();
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
async function tryOpenInApp(
  platform: "ios" | "android",
  normalizedUrl: string,
): Promise<boolean> {
  try {
    const { AppLauncher } = await import("@capacitor/app-launcher");

    // Build app-scheme URL from the https URL. We DO NOT inject any
    // title/description text — the original Google Maps URL is preserved
    // as a query value, so Google Maps app resolves the exact same place.
    let appUrl: string;
    if (platform === "ios") {
      // comgooglemaps:// supports ?url= to forward a full Maps URL.
      appUrl = `comgooglemaps://?url=${encodeURIComponent(normalizedUrl)}`;
    } else {
      // Android: use intent URL that forces com.google.android.apps.maps
      // and falls back to browser if not installed (S.browser_fallback_url).
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

/**
 * Open a Google Maps URL using app-first-with-browser-fallback strategy.
 * `url` should be a Google Maps URL (raw OK — will be normalized).
 */
export async function openGoogleMapsUrl(url: string): Promise<boolean> {
  const normalizedUrl = normalizeGoogleMapsUrl(url);
  if (!normalizedUrl) {
    console.warn("[MAP_OPEN_INVALID]", { url });
    return false;
  }

  const platform = await detectPlatform();
  console.log("[MAP_OPEN_STRATEGY]", {
    platform,
    normalizedUrl,
    strategy: "app-first-with-browser-fallback",
  });

  if (platform === "ios" || platform === "android") {
    console.log("[MAP_OPEN_APP_ATTEMPT]", { platform, normalizedUrl });
    const appOk = await tryOpenInApp(platform, normalizedUrl);
    if (appOk) return true;

    console.log("[MAP_OPEN_FALLBACK]", {
      reason: "app-deep-link-failed-or-unavailable",
      fallbackUrl: normalizedUrl,
    });

    const browserOk = await openInBrowser(normalizedUrl);
    if (browserOk) return true;

    console.log("[MAP_OPEN_FALLBACK]", {
      reason: "capacitor-browser-failed",
      fallbackUrl: normalizedUrl,
    });
    return openInWindowLocation(normalizedUrl);
  }

  // Web
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

// Back-compat shim. Second arg is intentionally ignored — we never derive
// a Maps URL from title/description text.
export async function openGoogleMaps(
  originalUrl: string,
  _placeText?: string,
): Promise<void> {
  await openGoogleMapsUrl(originalUrl);
}

export function normalizeMapsUrl(raw: string | undefined | null): string | null {
  return normalizeGoogleMapsUrl(raw);
}
