/**
 * Detect in-app browsers (Facebook / Messenger / Instagram / LINE / etc.)
 * which are NOT allowed by Google OAuth (403 disallowed_useragent).
 *
 * Only used on web. Does not affect native Capacitor app, which uses its own
 * Chrome Custom Tab / SFSafariViewController flow via @capacitor/browser.
 */
export type InAppBrowserKind =
  | "facebook"
  | "messenger"
  | "instagram"
  | "line"
  | "other"
  | null;

export function detectInAppBrowser(ua?: string): InAppBrowserKind {
  if (typeof navigator === "undefined" && !ua) return null;
  const s = (ua ?? navigator.userAgent ?? "").toLowerCase();
  if (!s) return null;
  // Facebook in-app: FBAN/FBAV ; Messenger: FB_IAB/FBAN ; Instagram: Instagram
  if (s.includes("fban") || s.includes("fbav") || s.includes("fb_iab")) {
    if (s.includes("messenger")) return "messenger";
    return "facebook";
  }
  if (s.includes("instagram")) return "instagram";
  if (s.includes(" line/") || s.includes(";line/") || s.endsWith(" line") || s.includes("/line/")) return "line";
  // LINE on iOS shows "Line/" segment
  if (/\bline\/[0-9]/.test(s)) return "line";
  return null;
}

export function getInAppBrowserInstructions(platformHint?: "ios" | "android" | "unknown"): {
  zh: string;
  en: string;
} {
  const isIOS =
    platformHint === "ios" ||
    (typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || ""));
  if (isIOS) {
    return {
      zh: "請點右上角「⋯」或分享按鈕，選擇「在 Safari 開啟」後再使用 Google 登入。",
      en: "Tap the ••• or share button (top right), choose 'Open in Safari', then sign in with Google.",
    };
  }
  return {
    zh: "請點右上角「⋯」，選擇「在 Chrome 開啟」後再使用 Google 登入。",
    en: "Tap the ••• menu (top right), choose 'Open in Chrome', then sign in with Google.",
  };
}
