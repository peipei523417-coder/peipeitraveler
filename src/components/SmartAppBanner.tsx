import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import dogTravelNew from "@/assets/dog-travel-new.png";

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
    const isNativeApp = /capacitor/i.test(ua) || (window as any).Capacitor;
    setIsMobileWeb(isMobile && !isNativeApp);
  }, []);

  if (!isMobileWeb || dismissed) return null;

  const handleOpenInApp = () => {
    // Try custom scheme first
    const deepLink = projectId
      ? `com.peitravel.smartplanner://share/${projectId}`
      : `com.peitravel.smartplanner://`;
    window.location.href = deepLink;
    
    // Fallback to store after delay
    setTimeout(() => {
      const ua = navigator.userAgent;
      if (/iPhone|iPad|iPod/i.test(ua)) {
        // TODO: Replace with actual App Store URL when published
        window.location.href = "https://apps.apple.com/app/peipeigotravel";
      } else {
        // TODO: Replace with actual Play Store URL when published
        window.location.href = "https://play.google.com/store/apps/details?id=com.peitravel.smartplanner";
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
