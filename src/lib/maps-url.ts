/**
 * Google Maps URL normalization + safe opener.
 *
 * The DB column `google_maps_url` stores the URL the user pasted as-is
 * (original_maps_url). At open time we derive a stable, well-formed
 * `normalized_maps_url` and open it via the system browser / Maps app.
 *
 * Goals:
 *  - Accept any common Google Maps share format: maps.app.goo.gl,
 *    google.com/maps, maps.google.com, goo.gl/maps.
 *  - Never crash; if normalization fails, fall back to the original URL.
 *  - Never embed inside the WebView — always open externally.
 */

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Extract lat,lng if the URL already exposes coordinates. */
function extractLatLng(url: string): { lat: number; lng: number } | null {
  // @lat,lng,zoom
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  // !3dLAT!4dLNG
  const dm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dm) return { lat: parseFloat(dm[1]), lng: parseFloat(dm[2]) };
  // ll=LAT,LNG  /  q=LAT,LNG
  const ll = url.match(/[?&](?:ll|q|query|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (ll) return { lat: parseFloat(ll[1]), lng: parseFloat(ll[2]) };
  return null;
}

/** Extract a textual place query (name / address) if present. */
function extractTextQuery(url: string): string | null {
  try {
    const u = new URL(url);
    const q =
      u.searchParams.get("q") ||
      u.searchParams.get("query") ||
      u.searchParams.get("destination");
    if (q && !/^-?\d+\.\d+,-?\d+\.\d+$/.test(q)) return q;
    // /maps/place/<name>/...
    const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (place) {
      const name = safeDecode(place[1]).replace(/\+/g, " ").trim();
      if (name) return name;
    }
    // /maps/search/<term>
    const search = u.pathname.match(/\/maps\/search\/([^/]+)/);
    if (search) {
      const term = safeDecode(search[1]).replace(/\+/g, " ").trim();
      if (term) return term;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function isShortLink(url: string): boolean {
  return /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url);
}

/**
 * Produce a stable Google Maps URL.
 * - Returns null when no improvement is possible (caller should use original).
 */
export function normalizeMapsUrl(original: string | undefined | null): string | null {
  if (!original) return null;
  const raw = original.trim();
  if (!raw) return null;
  // Only http(s) is safe to open externally.
  if (!/^https?:\/\//i.test(raw)) return null;

  // Short links must be resolved by the OS / Maps app — pass through.
  if (isShortLink(raw)) return null;

  const ll = extractLatLng(raw);
  if (ll) {
    return `https://www.google.com/maps/search/?api=1&query=${ll.lat},${ll.lng}`;
  }
  const text = extractTextQuery(raw);
  if (text) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
  }
  return null;
}

/** Open a Google Maps URL externally (system browser / Maps app).
 *  `placeText` is an optional fallback (title / location / address / place_name)
 *  used to build a stable search URL when the original is a short link.
 */
export async function openGoogleMaps(
  originalUrl: string,
  placeText?: string,
): Promise<void> {
  const original = (originalUrl || "").trim();
  if (!original) return;

  const normalized = normalizeMapsUrl(original);
  const shortUrlFallback = !normalized && isShortLink(original);
  const placeQuery = (placeText || "").trim();

  // Prefer a text-based search URL for short links when we have a place name —
  // raw maps.app.goo.gl / goo.gl/maps links occasionally fail to resolve.
  const textNormalized =
    shortUrlFallback && placeQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeQuery)}`
      : null;

  const final = textNormalized || normalized || original;

  // Hard guard: only allow http(s) — never custom schemes from untrusted input.
  if (!/^https?:\/\//i.test(final)) {
    console.warn("[maps] refused non-http url", { original });
    return;
  }

  let platform: "web" | "native" = "web";
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) platform = "native";
  } catch {
    /* web */
  }

  console.log("[maps] open", {
    platform,
    original_maps_url: original,
    normalized_maps_url: textNormalized || normalized,
    final_open_url: final,
    shortUrlFallback,
  });

  try {
    if (platform === "native") {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: final, presentationStyle: "fullscreen" });
      console.log("[maps] open success", { platform });
      return;
    }
  } catch (e) {
    console.warn("[maps] native open failed, fallback to window.open", e);
  }

  try {
    const w = window.open(final, "_blank", "noopener,noreferrer");
    if (!w) {
      // popup blocked — last-resort same-tab navigation
      window.location.href = final;
    }
    console.log("[maps] open success", { platform: "web" });
  } catch (e) {
    console.error("[maps] open error", e);
  }
}
