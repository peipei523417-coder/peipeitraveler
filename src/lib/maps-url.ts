/**
 * Google Maps URL helpers.
 *
 * Rules:
 *  - Only ever open the URL the user pasted. NEVER derive a Maps URL from
 *    title / description / location text — that is what caused "甜點街
 *    actually opens 台北101" style bugs.
 *  - Accept the common Google Maps share formats; auto-prepend https:// if
 *    the user omitted the scheme (e.g. `maps.app.goo.gl/xxx`).
 *  - Short links (maps.app.goo.gl / goo.gl/maps) and long links are passed
 *    through unchanged so the OS / Maps app resolves them correctly.
 *  - Never embed inside the WebView — always open externally.
 */

const GOOGLE_MAPS_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;

/**
 * Validate + normalize a Google Maps URL.
 * Returns the normalized https URL, or null if it is not a Google Maps URL.
 * Does NOT decode/encode, does NOT touch query string.
 */
export function normalizeGoogleMapsUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url) return null;

  // Auto-prepend https:// when scheme is missing.
  if (!/^https?:\/\//i.test(url)) {
    // Reject things that clearly aren't URLs (whitespace, no dot).
    if (/\s/.test(url) || !url.includes(".")) return null;
    url = "https://" + url;
  }

  // Must parse as a URL.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  // Build host+path for matching (covers `goo.gl/maps`).
  const hostPath = parsed.host + parsed.pathname;
  if (!GOOGLE_MAPS_HOST_RE.test(hostPath) && !GOOGLE_MAPS_HOST_RE.test(parsed.host)) {
    return null;
  }

  // Force https for safety; preserve query/hash untouched.
  if (parsed.protocol === "http:") parsed.protocol = "https:";
  return parsed.toString();
}

/**
 * Open a Google Maps URL externally. Returns true on success.
 * `url` MUST already come from `normalizeGoogleMapsUrl` (or be one) —
 * this function will re-validate as a safety net.
 */
export async function openGoogleMapsUrl(url: string): Promise<boolean> {
  const final = normalizeGoogleMapsUrl(url);
  if (!final) {
    console.warn("[maps] refused invalid url", { url });
    return false;
  }

  let platform: "web" | "native" = "web";
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) platform = "native";
  } catch {
    /* web */
  }

  if (platform === "native") {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: final, presentationStyle: "fullscreen" });
      return true;
    } catch (e) {
      console.warn("[maps] Capacitor Browser failed, falling back", e);
      try {
        window.location.href = final;
        return true;
      } catch (e2) {
        console.error("[maps] native fallback failed", e2);
        return false;
      }
    }
  }

  try {
    const w = window.open(final, "_blank", "noopener,noreferrer");
    if (!w) window.location.href = final;
    return true;
  } catch (e) {
    console.error("[maps] window.open failed", e);
    try {
      window.location.href = final;
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Back-compat shim.
// Older callers imported `openGoogleMaps(originalUrl, placeText?)`. The
// placeText fallback is intentionally removed — we never derive a Maps URL
// from a title/description anymore. The second arg is accepted but ignored.
// ---------------------------------------------------------------------------
export async function openGoogleMaps(
  originalUrl: string,
  _placeText?: string,
): Promise<void> {
  await openGoogleMapsUrl(originalUrl);
}

export function normalizeMapsUrl(raw: string | undefined | null): string | null {
  return normalizeGoogleMapsUrl(raw);
}
