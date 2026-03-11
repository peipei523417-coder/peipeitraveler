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
    const isNativeCallback = params.get("native_callback") === "1";
    if (!isNativeCallback) return;

    // Extract tokens from URL hash (implicit flow)
    // Format: #access_token=XXX&refresh_token=YYY&token_type=bearer&...
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const hashParams = new URLSearchParams(hash.substring(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (accessToken && refreshToken) {
        console.log("[NativeCallbackRelay] Tokens found, redirecting to native app…");
        const at = encodeURIComponent(accessToken);
        const rt = encodeURIComponent(refreshToken);
        window.location.replace(
          `com.peitravel.smartplanner://auth/callback?access_token=${at}&refresh_token=${rt}`
        );
        // Show a simple message while the redirect happens
        document.getElementById("root")!.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><p>正在返回 App⋯</p></div>';
        return; // Stop — don't render React
      }
    }

    // Also check for PKCE code in query params
    const code = params.get("code");
    if (code) {
      console.log("[NativeCallbackRelay] PKCE code found, redirecting to native app…");
      window.location.replace(
        `com.peitravel.smartplanner://auth/callback?code=${encodeURIComponent(code)}`
      );
      document.getElementById("root")!.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><p>正在返回 App⋯</p></div>';
      return;
    }

    // native_callback=1 but no tokens/code — might be an error.
    // Fall through and let React render normally.
    console.warn("[NativeCallbackRelay] native_callback=1 but no tokens or code found");
  } catch (e) {
    console.error("[NativeCallbackRelay] Error:", e);
  }
})();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
