import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import dogTravelNew from "@/assets/dog-travel-new.png";
import {
  IOS_APP_STORE_URL,
  ANDROID_PLAY_STORE_URL,
  detectStorePlatform,
  getStoreUrlForPlatform,
} from "@/config/storeLinks";

interface SmartAppBannerProps {
  projectId?: string;
}

export function SmartAppBanner({ projectId }: SmartAppBannerProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [isMobileWeb, setIsMobileWeb] = useState(false);
  // Deep link must carry the exact share code from the URL so the app opens
  // the same share entry (same key/password checks), not a different route.
  const { shareCode: routeShareCode } = useParams<{ shareCode: string }>();
  const shareTarget = (routeShareCode || projectId || "").trim().replace(/\/+$/, "");

  useEffect(() => {
    // Only show on mobile web browsers
    const ua = navigator.userAgent;
    const platform = detectStorePlatform();
    const isMobile = platform === "ios" || platform === "android";
    const isNativeApp = /capacitor/i.test(ua) || (window as unknown as { Capacitor?: unknown }).Capacitor;
    setIsMobileWeb(isMobile && !isNativeApp);

    if (isMobile && !isNativeApp) {
      console.log("[SHARE_EXISTING_FLOW_PRESERVED]", {
        platform: detectStorePlatform(),
        shareCode: projectId,
      });
    }
  }, [projectId]);

  if (!isMobileWeb || dismissed) return null;

  // User-initiated only. No timeout guessing, no automatic store redirect:
  // if the app is not installed the browser simply stays on this web page.
  const handleOpenInApp = () => {
    const deepLink = shareTarget
      ? `com.peitravel.smartplanner://share/${encodeURIComponent(shareTarget)}`
      : `com.peitravel.smartplanner://`;
    try {
      window.location.href = deepLink;
    } catch {
      // Browser refused the scheme — stay on web.
    }
  };

  const handleDownload = () => {
    const storeUrl = getStoreUrlForPlatform(detectStorePlatform());
    if (storeUrl) window.location.href = storeUrl;
  };

  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-3">
      <div className="container max-w-4xl flex items-center gap-3">
        <img src={dogTravelNew} alt="" className="w-10 h-10 rounded-lg object-contain" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground">{t("shareAppGateTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("shareAppGateDesc")}</p>
          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={handleDownload}
              className="text-xs text-primary underline underline-offset-2"
            >
              {t("shareAppGateDownload")}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t("shareAppGateWeb")}
            </button>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleOpenInApp}
          className="gap-1.5 shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5" />
          {t("shareAppGateOpen")}
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-full hover:bg-muted/50 shrink-0"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

// Re-export so callers (e.g. Download page) can reach the store URLs
// from a single import surface if needed.
export { IOS_APP_STORE_URL, ANDROID_PLAY_STORE_URL };
