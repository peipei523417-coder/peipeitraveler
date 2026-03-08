import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { AirplaneLoader } from "@/components/AirplaneLoader";

const NATIVE_SCHEME = "com.peitravel.smartplanner";

/**
 * Build the custom-scheme URL to bounce tokens back to the native app.
 * Works on both Android and iOS — the OS intercepts the custom scheme
 * because AndroidManifest / Info.plist declares the intent-filter / URL type.
 */
function buildReturnUrl(accessToken: string, refreshToken: string): string {
  const encodedAt = encodeURIComponent(accessToken);
  const encodedRt = encodeURIComponent(refreshToken);
  return `${NATIVE_SCHEME}://oauth-callback#access_token=${encodedAt}&refresh_token=${encodedRt}`;
}

/**
 * NativeOAuth relay page — runs in the EXTERNAL system browser
 * (Chrome Custom Tabs on Android, SFSafariViewController on iOS).
 *
 * Flow:
 * 1. Native app opens this page via Browser.open().
 * 2. Page initiates Lovable Cloud OAuth (or detects returning from OAuth).
 * 3. After getting tokens, shows a prominent "Return to App" link.
 *    The link uses the custom scheme which Android/iOS intercepts to open the app.
 *
 * IMPORTANT: We do NOT rely on programmatic `window.location.href` redirects
 * because Chrome Custom Tabs may silently block JavaScript-initiated scheme
 * or intent:// navigations. A user-tapped <a> link is the most reliable method.
 */
export default function NativeOAuth() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("正在登入中，請稍候⋯");
  const [hasError, setHasError] = useState(false);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  useEffect(() => {
    const provider = searchParams.get("provider") as "google" | "apple" | null;
    if (!provider || !["google", "apple"].includes(provider)) {
      setStatus("錯誤：未指定有效的登入方式");
      setHasError(true);
      return;
    }

    const doAuth = async () => {
      try {
        // Step 1: Check if we already have a session (returning from OAuth provider)
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession && localStorage.getItem("native_oauth_pending")) {
          localStorage.removeItem("native_oauth_pending");
          const url = buildReturnUrl(
            existingSession.access_token,
            existingSession.refresh_token
          );
          setReturnUrl(url);
          setStatus("登入成功！請點擊下方按鈕返回 App");

          // Also attempt a programmatic redirect as a bonus (may or may not work)
          setTimeout(() => {
            try { window.location.href = url; } catch {}
          }, 500);
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
          const url = buildReturnUrl(
            result.tokens.access_token,
            result.tokens.refresh_token
          );
          setReturnUrl(url);
          setStatus("登入成功！請點擊下方按鈕返回 App");
          setTimeout(() => {
            try { window.location.href = url; } catch {}
          }, 500);
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-6 px-6">
      {!hasError && !returnUrl && (
        <AirplaneLoader isComplete={false} onComplete={() => {}} />
      )}
      <p className="text-lg text-center text-gray-800">{status}</p>

      {/* Primary return button — user tap is most reliable for custom scheme */}
      {returnUrl && (
        <div className="flex flex-col items-center gap-4 mt-2">
          <a
            href={returnUrl}
            className="px-10 py-5 bg-blue-600 text-white rounded-2xl text-center font-bold text-xl shadow-xl active:bg-blue-700 no-underline"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            👆 點擊此處返回 App
          </a>
          <p className="text-sm text-gray-500 text-center">
            登入成功！點擊上方按鈕即可返回 PeiPeiGoTravel
          </p>
        </div>
      )}

      {hasError && (
        <p className="text-sm text-gray-500 text-center">
          請關閉此頁面並返回 PeiPeiGoTravel App
        </p>
      )}
    </div>
  );
}
