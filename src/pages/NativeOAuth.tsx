import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { AirplaneLoader } from "@/components/AirplaneLoader";

const NATIVE_SCHEME = "com.peitravel.smartplanner";
const NATIVE_PACKAGE = "com.peitravel.smartplanner";

/**
 * Build a redirect URL that works in Chrome Custom Tabs (Android)
 * and SFSafariViewController (iOS).
 *
 * Android Chrome Custom Tabs often block raw custom-scheme redirects
 * (`com.peitravel.smartplanner://...`). The `intent://` format is the
 * officially supported way to trigger an Android Intent from Chrome.
 *
 * iOS handles custom schemes directly, so we use the raw scheme there.
 */
function buildNativeRedirectUrl(accessToken: string, refreshToken: string): string {
  const fragment = `access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`;

  const isAndroid = /android/i.test(navigator.userAgent);
  if (isAndroid) {
    // intent://  format for Android Chrome Custom Tabs
    return `intent://oauth-callback#${fragment}#Intent;scheme=${NATIVE_SCHEME};package=${NATIVE_PACKAGE};end`;
  }
  // iOS / fallback: raw custom scheme
  return `${NATIVE_SCHEME}://oauth-callback#${fragment}`;
}

/**
 * NativeOAuth relay page — runs in the EXTERNAL system browser
 * (Chrome Custom Tabs on Android, SFSafariViewController on iOS).
 *
 * Flow:
 * 1. Native app opens this page via Browser.open().
 * 2. Page checks if a session already exists (returning from OAuth redirect).
 *    - YES → bounce tokens to the native app via intent:// / custom scheme.
 *    - NO  → initiate Lovable Cloud OAuth.
 * 3. OAuth redirects browser back to this origin; step 2 picks up the session.
 */
export default function NativeOAuth() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("正在登入中，請稍候⋯");
  const [hasError, setHasError] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    const provider = searchParams.get("provider") as "google" | "apple" | null;
    if (!provider || !["google", "apple"].includes(provider)) {
      setStatus("錯誤：未指定有效的登入方式");
      setHasError(true);
      return;
    }

    const doAuth = async () => {
      try {
        // Step 1: Check if we already have a session (post-OAuth redirect)
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession && localStorage.getItem("native_oauth_pending")) {
          localStorage.removeItem("native_oauth_pending");
          const url = buildNativeRedirectUrl(
            existingSession.access_token,
            existingSession.refresh_token
          );
          setStatus("登入成功！正在返回 App⋯");
          setRedirectUrl(url);
          // Use a small delay to allow the UI to update
          setTimeout(() => { window.location.href = url; }, 300);
          return;
        }

        // Step 2: No session yet — initiate OAuth
        localStorage.setItem("native_oauth_pending", "1");

        // CRITICAL: redirect_uri must return to THIS page so we can bounce tokens
        const currentUrl = window.location.href.split("?")[0]; // Remove any existing query params
        const result = await lovable.auth.signInWithOAuth(provider, {
          redirect_uri: `${window.location.origin}/#/native-oauth?provider=${provider}`,
        });

        if (result.redirected) {
          // Page is being redirected to the OAuth provider
          return;
        }

        if (result.error) {
          localStorage.removeItem("native_oauth_pending");
          setStatus(`登入失敗：${result.error.message}`);
          setHasError(true);
          return;
        }

        // Got tokens directly (rare path) — bounce to native app
        localStorage.removeItem("native_oauth_pending");
        if (result.tokens) {
          const url = buildNativeRedirectUrl(
            result.tokens.access_token,
            result.tokens.refresh_token
          );
          setStatus("登入成功！正在返回 App⋯");
          setRedirectUrl(url);
          setTimeout(() => { window.location.href = url; }, 300);
        }
      } catch (err) {
        console.error("NativeOAuth error:", err);
        localStorage.removeItem("native_oauth_pending");
        setStatus("登入時發生錯誤，請返回 App 重試");
        setHasError(true);
      }
    };

    doAuth();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-6">
      {!hasError && !redirectUrl && (
        <AirplaneLoader isComplete={false} onComplete={() => {}} />
      )}
      <p className="text-lg text-center text-foreground">{status}</p>

      {/* Manual fallback button — in case automatic redirect fails */}
      {redirectUrl && (
        <a
          href={redirectUrl}
          className="mt-4 px-6 py-3 bg-primary text-primary-foreground rounded-xl text-center font-bold"
        >
          點擊此處返回 App
        </a>
      )}

      {hasError && (
        <p className="text-sm text-muted-foreground text-center">
          請關閉此頁面並返回 PeiPeiGoTravel App
        </p>
      )}
    </div>
  );
}
