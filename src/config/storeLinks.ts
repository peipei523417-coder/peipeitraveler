/**
 * Centralized App Store / Google Play URLs for PeiTravel.
 * Used by SmartAppBanner and the /download fallback page.
 */
export const IOS_APP_STORE_URL =
  "https://apps.apple.com/app/id6761007171";
export const ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.peitravel.smartplanner";

export type StorePlatform = "ios" | "android" | "desktop" | "unknown";

export function detectStorePlatform(): StorePlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports a desktop Mac UA; a touch-capable "Macintosh" is an iPad.
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Windows|Linux/i.test(ua)) return "desktop";
  return "unknown";
}

export function getStoreUrlForPlatform(p: StorePlatform): string | null {
  if (p === "ios") return IOS_APP_STORE_URL;
  if (p === "android") return ANDROID_PLAY_STORE_URL;
  return null;
}
