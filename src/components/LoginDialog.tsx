import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/contexts/AuthContext";

import { toast } from "sonner";

/** Production URL used as OAuth redirect for native apps */
const PRODUCTION_URL = "https://peipeigotravel.lovable.app";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);

  const buildNativeOAuthUrl = (provider: "google" | "apple") => {
    // Per-platform deep-link scheme (matches Info.plist / AndroidManifest)
    const platform = (window as any).Capacitor?.getPlatform?.() ?? "web";
    const scheme =
      platform === "ios"
        ? "com.peipeigo.travel"
        : "com.peitravel.smartplanner";

    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    // Embed scheme in state so the relay knows where to deep-link back
    const state = `native_oauth_${scheme}_${nonce}`;

    const callbackUrl = new URL(PRODUCTION_URL);
    callbackUrl.searchParams.set("native_callback", "1");
    callbackUrl.searchParams.set("scheme", scheme);

    const params = new URLSearchParams({
      provider,
      redirect_uri: callbackUrl.toString(),
      state,
    });

    // Force Google account picker on native (avoid auto add-account flow)
    if (provider === "google") {
      params.set("prompt", "select_account");
    }

    return `${PRODUCTION_URL}/~oauth/initiate?${params.toString()}`;
  };

  const handleOAuthLogin = async (provider: "google" | "apple") => {
    if (loading) return; // prevent double-tap
    setLoading(provider);
    try {
      const isNative = !!(window as any).Capacitor?.isNativePlatform?.();

      if (isNative) {
        localStorage.setItem("native_oauth_pending", "1");
        localStorage.setItem("native_oauth_provider", provider);

        // Build URL synchronously, import Browser in parallel — fastest hand-off
        const oauthUrl = buildNativeOAuthUrl(provider);
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: oauthUrl, presentationStyle: "fullscreen" });
        onOpenChange(false);
        return;
      }

      // WEB: Use Lovable Cloud OAuth (redirects within browser)
      const { error, redirected } = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
        extraParams: {
          prompt: "select_account",
        },
      });

      if (redirected) return;

      if (error) {
        toast.error(`登入失敗：${error.message}`);
        return;
      }

      toast.success("登入成功！");
      onOpenChange(false);
    } catch (err) {
      console.error("OAuth error:", err);
      toast.error("登入時發生錯誤");
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">開始您的旅程 / Start Your Journey</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">正在開啟登入…</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-4">
            <Button
              variant="outline"
              size="lg"
              onClick={() => handleOAuthLogin("google")}
              disabled={loading !== null}
              className="w-full rounded-xl gap-3 h-12"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              使用 Google 登入 / Google
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={() => handleOAuthLogin("apple")}
              disabled={loading !== null}
              className="w-full rounded-xl gap-3 h-12"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              使用 Apple 登入 / Apple
            </Button>
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground pt-4">
          登入後，你建立的專案將綁定到你的帳號，只有你能編輯
        </p>
      </DialogContent>
    </Dialog>
  );
}
