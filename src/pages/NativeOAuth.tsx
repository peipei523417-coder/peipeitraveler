import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { AirplaneLoader } from "@/components/AirplaneLoader";

const NATIVE_SCHEME = "com.peitravel.smartplanner";
const NATIVE_PACKAGE = "com.peitravel.smartplanner";

/**
 * Build redirect URL(s) to bounce tokens back to the native app.
 *
 * Android: Use intent:// with S. (String) extras so tokens survive the
 * intent parsing. MainActivity.java reconstructs the URL fragment before
 * Capacitor processes it.
 *
 * iOS: Custom scheme with fragment works directly.
 */
function buildNativeRedirectUrls(accessToken: string, refreshToken: string) {
  const encodedAt = encodeURIComponent(accessToken);
  const encodedRt = encodeURIComponent(refreshToken);
  const fragment = `access_token=${encodedAt}&refresh_token=${encodedRt}`;

  const customSchemeUrl = `${NATIVE_SCHEME}://oauth-callback#${fragment}`;

  const isAndroid = /android/i.test(navigator.userAgent);
  if (isAndroid) {
    // intent:// with S. extras — tokens passed as intent string extras
    const intentUrl = `intent://oauth-callback#Intent;scheme=${NATIVE_SCHEME};package=${NATIVE_PACKAGE};S.access_token=${encodedAt};S.refresh_token=${encodedRt};end`;
    return { primary: intentUrl, fallback: customSchemeUrl };
  }

  // iOS / fallback
  return { primary: customSchemeUrl, fallback: customSchemeUrl };
}

/**
 * Attempt redirect with primary URL, then fallback after a delay.
 */
function attemptNativeRedirect(urls: { primary: string; fallback: string }) {
  // Primary attempt
  window.location.href = urls.primary;

  // If primary doesn't work within 1.5s, try fallback (custom scheme)
  if (urls.primary !== urls.fallback) {
    setTimeout(() => {
      window.location.href = urls.fallback;
    }, 1500);
  }
}

/**
 * NativeOAuth relay page — runs in the EXTERNAL system browser
 * (Chrome Custom Tabs on Android, SFSafariViewController on iOS).
 *
 * Flow:
 * 1. Native app opens this page via Browser.open().
 * 2. Page initiates Lovable Cloud OAuth (or detects returning from OAuth).
 * 3. After getting tokens, bounces to native app via intent:// or custom scheme.
 */
export default function NativeOAuth() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("正在登入中，請稍候⋯");
  const [hasError, setHasError] = useState(false);
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
        // Step 1: Check if we already have a session (post-OAuth redirect)
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession && localStorage.getItem("native_oauth_pending")) {
          localStorage.removeItem("native_oauth_pending");
          const urls = buildNativeRedirectUrls(
            existingSession.access_token,
            existingSession.refresh_token
          );
          setStatus("登入成功！正在返回 App⋯");
          setFallbackUrl(urls.fallback);
          setTimeout(() => attemptNativeRedirect(urls), 300);
          return;
        }

        // Step 2: No session yet — initiate OAuth
        localStorage.setItem("native_oauth_pending", "1");

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

        // Got tokens directly (Lovable auth bridge processed callback)
        localStorage.removeItem("native_oauth_pending");
        if (result.tokens) {
          const urls = buildNativeRedirectUrls(
            result.tokens.access_token,
            result.tokens.refresh_token
          );
          setStatus("登入成功！正在返回 App⋯");
          setFallbackUrl(urls.fallback);
          setTimeout(() => attemptNativeRedirect(urls), 300);
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
      {!hasError && !fallbackUrl && (
        <AirplaneLoader isComplete={false} onComplete={() => {}} />
      )}
      <p className="text-lg text-center text-foreground">{status}</p>

      {/* Manual fallback button — ALWAYS visible after login success */}
      {fallbackUrl && (
        <div className="flex flex-col items-center gap-3 mt-4">
          <a
            href={fallbackUrl}
            className="px-8 py-4 bg-primary text-primary-foreground rounded-xl text-center font-bold text-lg shadow-lg"
          >
            👆 點擊此處返回 App
          </a>
          <p className="text-sm text-muted-foreground text-center">
            如果沒有自動跳轉，請點擊上方按鈕
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
