import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Smartphone } from "lucide-react";
import dogTravelNew from "@/assets/dog-travel-new.png";
import {
  IOS_APP_STORE_URL,
  ANDROID_PLAY_STORE_URL,
  detectStorePlatform,
} from "@/config/storeLinks";

/**
 * Fallback page shown when a share link is opened without the PeiTravel
 * app installed (or on desktop / unknown platform). Never redirects
 * automatically — only provides explicit download buttons so the user
 * is never stuck on a blank or auto-jumping page.
 *
 * Used as a manual destination via `<a href="#/download?share=CODE">`.
 * The deep-link / share-flow itself (index.html + DeepLinkHandler) is
 * unchanged so already-installed users keep their existing behavior.
 */
export default function Download() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [platform, setPlatform] = useState<ReturnType<typeof detectStorePlatform>>("unknown");
  const shareCode = params.get("share") || "";

  useEffect(() => {
    const p = detectStorePlatform();
    setPlatform(p);
    console.log("[SHARE_STORE_FALLBACK]", {
      platform: p,
      targetStoreUrl:
        p === "ios" ? IOS_APP_STORE_URL : p === "android" ? ANDROID_PLAY_STORE_URL : null,
      shareCode,
    });
  }, [shareCode]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <img
          src={dogTravelNew}
          alt=""
          className="w-32 h-32 mx-auto object-contain"
        />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            開啟 PeiTravel 查看共享行程
          </h1>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            如果尚未安裝 App，請先下載 PeiTravel，再回來開啟這個分享連結。
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href={IOS_APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              console.log("[SHARE_STORE_REDIRECT]", {
                platform: "ios",
                targetStoreUrl: IOS_APP_STORE_URL,
              })
            }
          >
            <Button size="lg" className="w-full gap-2">
              <Smartphone className="w-4 h-4" />
              App Store 下載
            </Button>
          </a>
          <a
            href={ANDROID_PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              console.log("[SHARE_STORE_REDIRECT]", {
                platform: "android",
                targetStoreUrl: ANDROID_PLAY_STORE_URL,
              })
            }
          >
            <Button size="lg" variant="outline" className="w-full gap-2">
              <Smartphone className="w-4 h-4" />
              Google Play 下載
            </Button>
          </a>
        </div>

        {shareCode && (
          <button
            type="button"
            onClick={() => navigate(`/share/${shareCode}`)}
            className="text-xs text-muted-foreground underline"
          >
            以網頁版繼續瀏覽
          </button>
        )}

        <p className="text-[11px] text-muted-foreground/70">
          偵測到平台：{platform}
        </p>
      </div>
    </div>
  );
}
