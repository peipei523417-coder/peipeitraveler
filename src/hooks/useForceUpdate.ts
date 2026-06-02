import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compareSemver } from "@/lib/version-compare";

export type ForceUpdateState = {
  required: boolean;
  loading: boolean;
  storeUrl: string;
  message: string;
  currentVersion: string;
  currentBuild: number | string;
  platform: "ios" | "android" | "web";
};

/**
 * Reads remote min-version config and compares against the running native
 * version. Fails OPEN — if anything goes wrong we never block the user.
 */
export function useForceUpdate(): ForceUpdateState {
  const [state, setState] = useState<ForceUpdateState>({
    required: false,
    loading: true,
    storeUrl: "",
    message: "",
    currentVersion: "",
    currentBuild: "",
    platform: "web",
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1. Detect platform + version (native only — web is never forced).
        let platform: "ios" | "android" | "web" = "web";
        let currentVersion = "";
        let currentBuild: number | string = "";

        try {
          const { Capacitor } = await import("@capacitor/core");
          if (Capacitor.isNativePlatform()) {
            platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";
            const { App: CapApp } = await import("@capacitor/app");
            const info = await CapApp.getInfo();
            currentVersion = info.version || "";
            currentBuild = info.build || "";
          }
        } catch (e) {
          console.warn("[forceUpdate] platform/version detect failed", e);
        }

        if (platform === "web") {
          if (!cancelled) setState(s => ({ ...s, loading: false, platform }));
          return;
        }

        // 2. Read remote config — fail open on any error.
        const { data, error } = await supabase
          .from("app_config")
          .select("*")
          .eq("id", "global")
          .maybeSingle();

        if (error || !data) {
          console.warn("[forceUpdate] config fetch failed — fail open", error);
          if (!cancelled) setState(s => ({ ...s, loading: false, platform, currentVersion, currentBuild }));
          return;
        }

        if (!data.force_update_enabled) {
          console.log("[forceUpdate] disabled in config — skip");
          if (!cancelled) setState(s => ({ ...s, loading: false, platform, currentVersion, currentBuild }));
          return;
        }

        // 3. Compare. Build/versionCode wins when present and current numeric.
        let shouldForce = false;
        const buildNum = typeof currentBuild === "string" ? parseInt(currentBuild, 10) : currentBuild;
        if (platform === "ios") {
          const minBuild = data.min_ios_build ?? 0;
          if (Number.isFinite(buildNum) && buildNum > 0 && minBuild > 0) {
            shouldForce = buildNum < minBuild;
          } else if (currentVersion) {
            shouldForce = compareSemver(currentVersion, data.min_ios_version || "0.0.0") < 0;
          }
        } else {
          const minCode = data.min_android_version_code ?? 0;
          if (Number.isFinite(buildNum) && buildNum > 0 && minCode > 0) {
            shouldForce = buildNum < minCode;
          } else if (currentVersion) {
            shouldForce = compareSemver(currentVersion, data.min_android_version || "0.0.0") < 0;
          }
        }

        const storeUrl = platform === "ios" ? data.app_store_url : data.play_store_url;
        console.log("[forceUpdate] check", {
          platform,
          currentVersion,
          currentBuild,
          remoteMinVersion: platform === "ios" ? data.min_ios_version : data.min_android_version,
          remoteMinBuild: platform === "ios" ? data.min_ios_build : data.min_android_version_code,
          shouldForceUpdate: shouldForce,
          storeUrl,
        });

        if (!cancelled) {
          setState({
            required: shouldForce,
            loading: false,
            storeUrl: storeUrl || "",
            message: data.force_update_message || "",
            currentVersion,
            currentBuild,
            platform,
          });
        }
      } catch (e) {
        console.warn("[forceUpdate] unexpected error — fail open", e);
        if (!cancelled) setState(s => ({ ...s, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
