import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { lovable } from "@/integrations/lovable";
import { AirplaneLoader } from "@/components/AirplaneLoader";

/**
 * NativeOAuth relay page.
 *
 * Flow:
 * 1. Native app opens https://peipeigotravel.lovable.app/native-oauth?provider=google
 *    in the system browser (Chrome Custom Tabs / Safari).
 * 2. This page initiates Lovable Cloud OAuth (redirects to Google via /~oauth/initiate).
 * 3. After the user authenticates, Lovable Cloud returns tokens via postMessage.
 * 4. This page redirects to com.peitravel.smartplanner://oauth-callback#access_token=...&refresh_token=...
 * 5. The Android/iOS intent filter catches the custom scheme and opens the app.
 * 6. DeepLinkHandler in App.tsx extracts tokens and calls supabase.auth.setSession().
 */
export default function NativeOAuth() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("正在登入中，請稍候⋯");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const provider = searchParams.get("provider") as "google" | "apple" | null;
    if (!provider || !["google", "apple"].includes(provider)) {
      setStatus("錯誤：未指定有效的登入方式");
      setHasError(true);
      return;
    }

    const NATIVE_SCHEME = "com.peitravel.smartplanner";

    const doAuth = async () => {
      try {
        const result = await lovable.auth.signInWithOAuth(provider, {
          redirect_uri: window.location.origin,
        });

        if (result.redirected) {
          // Page is being redirected to the OAuth provider — nothing more to do here.
          return;
        }

        if (result.error) {
          setStatus(`登入失敗：${result.error.message}`);
          setHasError(true);
          return;
        }

        // Got tokens — redirect back to the native app
        const { access_token, refresh_token } = result.tokens;
        const callbackUrl = `${NATIVE_SCHEME}://oauth-callback#access_token=${encodeURIComponent(access_token)}&refresh_token=${encodeURIComponent(refresh_token)}`;
        window.location.href = callbackUrl;
      } catch (err) {
        console.error("NativeOAuth error:", err);
        setStatus("登入時發生錯誤，請返回 App 重試");
        setHasError(true);
      }
    };

    doAuth();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-6">
      {!hasError && (
        <AirplaneLoader isComplete={false} onComplete={() => {}} />
      )}
      <p className="text-lg text-center text-foreground">{status}</p>
      {hasError && (
        <p className="text-sm text-muted-foreground text-center">
          請關閉此頁面並返回 PeiPeiGoTravel App
        </p>
      )}
    </div>
  );
}
