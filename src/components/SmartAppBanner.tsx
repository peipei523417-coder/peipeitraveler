import { useState, useEffect } from "react";
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

  useEffect(() => {
    // Only show on mobile web browsers
    const ua = navigator.userAgent;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
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

  const handleOpenInApp = () => {
    const platform = detectStorePlatform();
    console.log("[SHARE_APP_OPEN_ATTEMPT]", { platform, shareCode: projectId });
    console.log("[SHARE_DEEPLINK_ATTEMPT]", { shareCode: projectId, platform });

    // Try custom scheme first — preserves existing share/deep-link flow.
    const deepLink = projectId
      ? `com.peitravel.smartplanner://share/${projectId}`
      : `com.peitravel.smartplanner://`;

    let leftPage = false;
    const onBlur = () => { leftPage = true; };
    window.addEventListener("blur", onBlur, { once: true });
    window.location.href = deepLink;

    // Fallback to store after delay (only if user is still on this page).
    setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      if (leftPage) return; // App opened — do nothing.

      const storeUrl = getStoreUrlForPlatform(platform);
      console.log("[SHARE_APP_NOT_INSTALLED]", { platform, shareCode: projectId });
      console.log("[SHARE_APP_NOT_INSTALLED_FALLBACK]", {
        platform,
        targetStoreUrl: storeUrl,
      });
      if (storeUrl) {
        console.log("[SHARE_STORE_REDIRECT]", { platform, targetStoreUrl: storeUrl });
        window.location.href = storeUrl;
      } else {
        // Unknown/desktop — go to download page instead of forcing a store.
        const target = `${window.location.origin}/#/download${
          projectId ? `?share=${encodeURIComponent(projectId)}` : ""
        }`;
        console.log("[SHARE_STORE_FALLBACK]", { platform, targetStoreUrl: target });
        window.location.href = target;
      }
    }, 1500);
  };

  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-3">
      <div className="container max-w-4xl flex items-center gap-3">
        <img src={dogTravelNew} alt="" className="w-10 h-10 rounded-lg object-contain" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground">{t("smartBannerTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("smartBannerDesc")}</p>
        </div>
        <Button
          size="sm"
          onClick={handleOpenInApp}
          className="gap-1.5 shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5" />
          {t("openInApp")}
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
