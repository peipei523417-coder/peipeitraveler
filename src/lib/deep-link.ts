/**
 * Extract the share code from a native deep link URL (same rule the app has
 * always used, now shared + tested). Supports:
 *  - https://peipeigotravel.lovable.app/share/<code>  (App Links / Universal Links)
 *  - https://peipeigotravel.lovable.app/#/share/<code>
 *  - com.peitravel.smartplanner://share/<code>          (custom scheme)
 * Returns null for OAuth callbacks and anything else.
 */
export function parseShareDeepLink(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/share\/([^?#\s]+)/);
  if (!m) return null;
  const code = m[1].replace(/\/+$/, "");
  return code || null;
}
