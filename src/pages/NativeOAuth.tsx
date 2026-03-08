import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { AirplaneLoader } from "@/components/AirplaneLoader";

const NATIVE_SCHEME = "com.peitravel.smartplanner";
const NATIVE_HOST = "oauth-callback";

/**
 * Build TWO return URLs:
 * 1. Primary: intent:// URL with tokens as S. (String) extras — most reliable on Android
 * 2. Fallback: custom scheme URL with tokens as QUERY PARAMETERS
 */
function buildIntentUrl(accessToken: string, refreshToken: string): string {
  const encodedAt = encodeURIComponent(accessToken);
  const encodedRt = encodeURIComponent(refreshToken);
  return `intent://${NATIVE_HOST}#Intent;scheme=${NATIVE_SCHEME};S.access_token=${encodedAt};S.refresh_token=${encodedRt};end`;
}

function buildFallbackUrl(accessToken: string, refreshToken: string): string {
  const encodedAt = encodeURIComponent(accessToken);
  const encodedRt = encodeURIComponent(refreshToken);
  return `${NATIVE_SCHEME}://${NATIVE_HOST}?access_token=${encodedAt}&refresh_token=${encodedRt}`;
}

function showReturnButtons(
  accessToken: string,
  refreshToken: string,
  setIntentUrl: (u: string) => void,
  setFallbackUrl: (u: string) => void,
  setStatus: (s: string) => void,
) {
  setIntentUrl(buildIntentUrl(accessToken, refreshToken));
  setFallbackUrl(buildFallbackUrl(accessToken, refreshToken));
  setStatus("登入成功！請點擊下方按鈕返回 App");
}

/**
 * NativeOAuth relay page — runs in the EXTERNAL system browser
 * (Chrome Custom Tabs on Android, SFSafariViewController on iOS).
 *
 * Flow:
 * 1. Native app opens this page via Browser.open().
 * 2. Page initiates OAuth (or detects returning from OAuth).
 * 3. After getting tokens, shows a prominent "Return to App" link.
 *
 * IMPORTANT: redirect_uri MUST NOT contain # (hash/fragment).
 * OAuth standard forbids fragments in redirect URIs, and HTTP 302
 * redirects strip fragments entirely, causing the HashRouter route
 * to be lost (leading to 404).
 */
export default function NativeOAuth() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("正在登入中，請稍候⋯");
  const [hasError, setHasError] = useState(false);
  const [intentUrl, setIntentUrl] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  useEffect(() => {
    const provider = searchParams.get("provider") as "google" | "apple" | null;
    if (!provider || !["google", "apple"].includes(provider)) {
      setStatus("錯誤：未指定有效的登入方式");
      setHasError(true);
      return;
    }

    const doAuth = async () => {
      try {
        // Step 0: Check for tokens stored by main.tsx pre-render interceptor
        // (This handles the case where auth bridge returned tokens in URL hash/query)
        const storedTokensJson = sessionStorage.getItem('native_oauth_tokens');
        if (storedTokensJson) {
          sessionStorage.removeItem('native_oauth_tokens');
          try {
            const storedTokens = JSON.parse(storedTokensJson);
            if (storedTokens.access_token && storedTokens.refresh_token) {
              console.log("[NativeOAuth] Using tokens from interceptor");
              await supabase.auth.setSession({
                access_token: storedTokens.access_token,
                refresh_token: storedTokens.refresh_token,
              });
              localStorage.removeItem("native_oauth_pending");
              localStorage.removeItem("native_oauth_provider");
              showReturnButtons(
                storedTokens.access_token,
                storedTokens.refresh_token,
                setIntentUrl, setFallbackUrl, setStatus,
              );
              return;
            }
          } catch (e) {
            console.warn("[NativeOAuth] Failed to parse stored tokens:", e);
          }
        }

        // Step 1: Check if we already have a session (returning from OAuth provider)
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession && localStorage.getItem("native_oauth_pending")) {
          console.log("[NativeOAuth] Found existing session");
          localStorage.removeItem("native_oauth_pending");
          localStorage.removeItem("native_oauth_provider");
          showReturnButtons(
            existingSession.access_token,
            existingSession.refresh_token,
            setIntentUrl, setFallbackUrl, setStatus,
          );
          return;
        }

        // Step 2: No session yet — initiate OAuth
        // Store provider so main.tsx interceptor can restore the route
        localStorage.setItem("native_oauth_pending", "1");
        localStorage.setItem("native_oauth_provider", provider);

        // CRITICAL: redirect_uri MUST NOT contain # (hash fragment)
        // Use plain origin. The main.tsx interceptor will handle the redirect
        // back to this page after tokens are extracted.
        const result = await lovable.auth.signInWithOAuth(provider, {
          redirect_uri: window.location.origin,
        });

        if (result.redirected) {
          // Page is being redirected to the OAuth provider
          return;
        }

        if (result.error) {
          localStorage.removeItem("native_oauth_pending");
          localStorage.removeItem("native_oauth_provider");
          setStatus(`登入失敗：${result.error.message}`);
          setHasError(true);
          return;
        }

        // Got tokens directly (Lovable auth bridge processed callback)
        localStorage.removeItem("native_oauth_pending");
        localStorage.removeItem("native_oauth_provider");
        if (result.tokens) {
          console.log("[NativeOAuth] Got tokens from auth bridge");
          showReturnButtons(
            result.tokens.access_token,
            result.tokens.refresh_token,
            setIntentUrl, setFallbackUrl, setStatus,
          );
        }
      } catch (err) {
        console.error("NativeOAuth error:", err);
        localStorage.removeItem("native_oauth_pending");
        localStorage.removeItem("native_oauth_provider");
        setStatus("登入時發生錯誤，請返回 App 重試");
        setHasError(true);
      }
    };

    doAuth();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 px-6">
      {!hasError && !intentUrl && (
        <AirplaneLoader isComplete={false} onComplete={() => {}} />
      )}
      <p className="text-lg text-center text-foreground">{status}</p>

      {intentUrl && fallbackUrl && (
        <div className="flex flex-col items-center gap-4 mt-2">
          <a
            href={intentUrl}
            className="px-10 py-5 bg-primary text-primary-foreground rounded-2xl text-center font-bold text-xl shadow-xl no-underline"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            👆 點擊此處返回 App
          </a>
          <a
            href={fallbackUrl}
            className="px-6 py-3 bg-muted text-muted-foreground rounded-xl text-center text-sm no-underline"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            若無法返回，請點這裡
          </a>
          <p className="text-sm text-muted-foreground text-center">
            登入成功！點擊上方按鈕即可返回 PeiPeiGoTravel
          </p>
        </div>
      )}

      {hasError && (
        <p className="text-sm text-muted-foreground text-center">
          請關閉此頁面並返回 PeiPeiGoTravel App
        </p>
      )}
    </div>
  );
}
