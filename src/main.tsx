import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Import i18n AFTER React to ensure proper initialization
import "./i18n";

/**
 * PRE-RENDER INTERCEPTOR — Native OAuth Callback Relay
 *
 * When a native app does OAuth via Chrome Custom Tabs, Supabase redirects
 * back to https://peipeigotravel.lovable.app?native_callback=1#access_token=…
 *
 * This interceptor detects that case and immediately redirects to the native
 * deep link scheme with the tokens, so the app receives them via intent.
 *
 * This runs BEFORE React renders to avoid any flash of UI.
 */
(() => {
  try {
    // Only run on the WEB version (Chrome Custom Tab loads the web page).
    // On native (capacitor://localhost), skip entirely.
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    if (isNative) {
      // Clean up any stale flags from previous attempts
      localStorage.removeItem("native_oauth_pending");
      localStorage.removeItem("native_oauth_provider");
      localStorage.removeItem("oauth_returning");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const hashParams = hash.startsWith("#")
      ? new URLSearchParams(hash.substring(1))
      : new URLSearchParams();

    const callbackState = hashParams.get("state") || params.get("state");
    const isNativeCallback =
      params.get("native_callback") === "1" ||
      callbackState?.startsWith("native_oauth_") === true;
    if (!isNativeCallback) return;

    // Resolve target deep-link scheme:
    // 1) ?scheme= query param (set by LoginDialog), or
    // 2) state suffix `native_oauth_<scheme>_<nonce>`, or
    // 3) fallback to Android scheme.
    let scheme = params.get("scheme") || "";
    if (!scheme && callbackState?.startsWith("native_oauth_")) {
      const rest = callbackState.substring("native_oauth_".length);
      // scheme is everything before the last underscore-nonce; only accept known ones
      if (rest.startsWith("com.peipeigo.travel_")) scheme = "com.peipeigo.travel";
      else if (rest.startsWith("com.peitravel.smartplanner_")) scheme = "com.peitravel.smartplanner";
    }
    if (!scheme) scheme = "com.peitravel.smartplanner";

    // Branded white loading screen — NO Lovable text/branding visible to the user.
    const renderBrandedLoader = () => {
      document.documentElement.style.background = "#ffffff";
      document.body.style.background = "#ffffff";
      document.body.style.margin = "0";
      const root = document.getElementById("root");
      if (root) {
        root.innerHTML =
          '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#111;">' +
          '<div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#3b82f6,#06b6d4);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:22px;margin-bottom:18px;">P</div>' +
          '<div style="font-size:15px;font-weight:600;margin-bottom:6px;">PeiPeiGoTravel</div>' +
          '<div style="font-size:13px;color:#888;">正在返回 App…</div>' +
          '</div>';
      }
    };

    const goNative = (suffix: string) => {
      const target = `${scheme}://auth/callback${suffix}`;
      console.log("[NativeCallbackRelay] Deep linking →", target);
      renderBrandedLoader();
      // Trigger immediately
      window.location.replace(target);
    };

    // Implicit flow tokens
    if (hash && hash.includes("access_token")) {
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        goNative(
          `?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`
        );
        return;
      }
    }

    // PKCE code
    const code = params.get("code");
    if (code) {
      goNative(`?code=${encodeURIComponent(code)}`);
      return;
    }

    // native_callback=1 but no tokens/code — show branded screen instead of Lovable UI
    console.warn("[NativeCallbackRelay] native_callback=1 but no tokens or code found");
    renderBrandedLoader();
    return;
  } catch (e) {
    console.error("[NativeCallbackRelay] Error:", e);
  }
})();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
