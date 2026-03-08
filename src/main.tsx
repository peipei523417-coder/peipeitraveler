import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Import i18n AFTER React to ensure proper initialization
import "./i18n";

/**
 * PRE-RENDER INTERCEPTOR for Native OAuth Hash Conflict
 * 
 * Problem: After OAuth, the auth bridge may redirect to the origin with tokens
 * in the URL hash (#access_token=...), which OVERWRITES the HashRouter route
 * (#/native-oauth?provider=google), causing a 404.
 * 
 * Solution: Before React renders, detect this situation and:
 * 1. Extract tokens from the hash
 * 2. Store them in sessionStorage for NativeOAuth to pick up
 * 3. Restore the correct HashRouter route
 */
(() => {
  try {
    const isPending = localStorage.getItem('native_oauth_pending');
    if (!isPending) return;

    const hash = window.location.hash;
    const search = window.location.search;

    // Case 1: Tokens in hash (overwriting HashRouter route)
    // e.g. #access_token=XXX&refresh_token=YYY
    if (hash && !hash.startsWith('#/') && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        sessionStorage.setItem('native_oauth_tokens', JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
        }));
      }
      // Restore correct HashRouter route
      const provider = localStorage.getItem('native_oauth_provider') || 'google';
      window.location.replace(window.location.pathname + window.location.search + `#/native-oauth?provider=${provider}`);
      return; // Page will reload with correct hash
    }

    // Case 2: Tokens in query params (some auth bridges do this)
    // e.g. ?access_token=XXX&refresh_token=YYY
    if (search && search.includes('access_token')) {
      const params = new URLSearchParams(search);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        sessionStorage.setItem('native_oauth_tokens', JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
        }));
      }
      // Redirect to correct HashRouter route (strip query params)
      const provider = localStorage.getItem('native_oauth_provider') || 'google';
      window.location.replace(window.location.pathname + `#/native-oauth?provider=${provider}`);
      return; // Page will reload with correct hash
    }

    // Case 3: Hash was lost entirely (302 redirect stripped fragment)
    // URL is just https://peipeigotravel.lovable.app/ with no hash
    if (!hash || hash === '' || hash === '#' || hash === '#/') {
      // The lovable auth library may have stored tokens internally
      // Redirect to NativeOAuth so it can check for session
      const provider = localStorage.getItem('native_oauth_provider') || 'google';
      window.location.replace(window.location.pathname + `#/native-oauth?provider=${provider}`);
      return;
    }
  } catch (e) {
    console.error('[NativeOAuth Interceptor] Error:', e);
  }
})();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
