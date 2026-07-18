/**
 * Safe cross-platform opener for arbitrary external URLs (e.g. related_link
 * pointing to KKday / Klook / YouTube / official sites).
 *
 * - Accepts ONLY http:// or https://.
 * - Web: opens a real top-level tab via window.open(_blank, noopener,noreferrer)
 *   with an anchor-click fallback (needed when the app runs inside a
 *   sandboxed preview iframe that suppresses window.open).
 * - Native (Capacitor iOS/Android): prefers AppLauncher so the OS can hand
 *   the URL to the matching app (YouTube app, browser, etc.). Falls back to
 *   Capacitor Browser (SFSafariViewController / Custom Tab) if AppLauncher
 *   is not available or the URL cannot be handled.
 *
 * This helper is INTENTIONALLY separate from the map-URL pipeline in
 * src/lib/maps-url.ts. It does NOT apply any Google / Naver / Amap URL
 * cleaning or rewriting.
 */

export function isSafeExternalUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isNative(): boolean {
  try {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export async function openExternalLink(raw: string): Promise<boolean> {
  if (!isSafeExternalUrl(raw)) {
    console.warn("[external-link] rejected non-http(s) URL");
    return false;
  }
  const url = String(raw).trim();

  if (isNative()) {
    // 1) AppLauncher — hands URL to system so YouTube / installed handler apps win.
    try {
      const { AppLauncher } = await import("@capacitor/app-launcher");
      try {
        const { value } = await AppLauncher.canOpenUrl({ url });
        if (value) {
          await AppLauncher.openUrl({ url });
          return true;
        }
      } catch {
        // canOpenUrl unsupported / not configured — try openUrl directly.
      }
      try {
        await AppLauncher.openUrl({ url });
        return true;
      } catch {
        // fall through to Browser
      }
    } catch {
      // plugin missing — fall through
    }
    // 2) Browser plugin — in-app browser (Safari VC / Custom Tab)
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
      return true;
    } catch (e) {
      console.warn("[external-link] native open failed", e);
      return false;
    }
  }

  // Web — prefer window.open new tab
  try {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) return true;
  } catch {
    // continue to anchor fallback
  }
  // Anchor click fallback (used when window.open is suppressed by sandboxed
  // preview iframes). A synthesized anchor with target="_blank" still opens
  // a real top-level tab in that case.
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch (e) {
    console.warn("[external-link] web open failed", e);
    return false;
  }
}
