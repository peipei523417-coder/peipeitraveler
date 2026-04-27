import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Import i18n AFTER React to ensure proper initialization
import "./i18n";

/**
 * Safety net: index.html runs the OAuth relay BEFORE this module loads,
 * so in normal flow we never reach React on a callback URL. If for any
 * reason the inline script didn't fire (e.g. cached old HTML), do it here.
 */
(() => {
  try {
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    if (isNative) {
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

    let scheme = params.get("scheme") || "";
    if (!scheme && callbackState?.startsWith("native_oauth_")) {
      const rest = callbackState.substring("native_oauth_".length);
      if (rest.startsWith("com.peipeigo.travel_")) scheme = "com.peipeigo.travel";
      else if (rest.startsWith("com.peitravel.smartplanner_")) scheme = "com.peitravel.smartplanner";
    }
    if (!scheme) scheme = "com.peitravel.smartplanner";

    let suffix = "";
    if (hash && hash.includes("access_token")) {
      const at = hashParams.get("access_token");
      const rt = hashParams.get("refresh_token");
      if (at && rt) suffix = `?access_token=${encodeURIComponent(at)}&refresh_token=${encodeURIComponent(rt)}`;
    }
    if (!suffix) {
      const code = params.get("code");
      if (code) suffix = `?code=${encodeURIComponent(code)}`;
    }

    window.location.replace(`${scheme}://auth/callback${suffix}`);
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
