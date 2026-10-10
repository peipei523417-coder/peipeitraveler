import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { IOS_APP_STORE_URL, ANDROID_PLAY_STORE_URL } from "@/config/storeLinks";

/** Final approved zh-TW copy; other languages come from i18n `promoText`. */
export const PROMO_TEXT_ZH =
  "✈️ PeiTravel 免費規劃旅行\n🗺️📍 整合地圖導航\n✨ 不用再傳截圖，一起編輯行程，分享超方便！";

/** Promo lines, one blank line, then the store URL on its own line. */
export function buildPromoMessage(storeUrl: string, promoText: string = PROMO_TEXT_ZH): string {
  return `${promoText}\n\n${storeUrl}`;
}

function isCancel(e: unknown): boolean {
  const msg = String((e as { message?: string; name?: string })?.message || (e as { name?: string })?.name || e).toLowerCase();
  return msg.includes("cancel") || msg.includes("abort");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

async function sharePromo(storeUrl: string) {
  const t = i18n.t.bind(i18n);
  const text = buildPromoMessage(storeUrl, t("promoText"));
  const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  // URL is already inside `text`; passing it separately makes some apps (LINE) show it twice.
  if (isNative) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ text, dialogTitle: t("recommendTitle") });
      return;
    } catch (e) {
      if (isCancel(e)) return;
      // Plugin missing in an older app build — fall through.
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (isCancel(e)) return;
    }
  }
  if (await copyText(text)) toast.success(t("promoCopied"));
  else toast.error(t("promoCopyFailed"));
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden>
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.29-3.52ZM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22Z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden>
      <path d="M3.6 2.2a1 1 0 0 0-.6.93v17.74a1 1 0 0 0 .6.93l9.56-9.8L3.6 2.2Zm10.97 8.36 2.7-2.77L5.1 1.05l9.47 9.51Zm0 2.88L5.1 22.95l12.17-6.74-2.7-2.77Zm4.12-4.85-3.04 3.11 3.04 3.12 2.86-1.58a1 1 0 0 0 0-1.75l-2.86-1.9Z" />
    </svg>
  );
}

export function RecommendAppCard() {
  const { t } = useTranslation();
  return (
    <section className="mb-4 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 md:flex md:items-center md:justify-between md:gap-3 md:py-1.5">
      <div className="min-w-0">
        <h2 className="text-[13px] font-bold leading-tight text-foreground">{t("recommendTitle")}</h2>
        <p className="text-[11.5px] font-normal leading-snug text-foreground/70 break-words">{t("recommendSubtitle")}</p>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 md:mt-0 md:flex md:shrink-0">
        <button
          type="button"
          onClick={() => sharePromo(IOS_APP_STORE_URL)}
          className="inline-flex min-h-[44px] md:min-h-[32px] items-center justify-center gap-1 rounded-lg border border-border bg-card px-2 md:px-2.5 text-xs font-semibold text-foreground active:bg-muted/40"
        >
          <AppleIcon />
          {t("shareIosVersion")}
        </button>
        <button
          type="button"
          onClick={() => sharePromo(ANDROID_PLAY_STORE_URL)}
          className="inline-flex min-h-[44px] md:min-h-[32px] items-center justify-center gap-1 rounded-lg border border-border bg-card px-2 md:px-2.5 text-xs font-semibold text-foreground active:bg-muted/40"
        >
          <PlayIcon />
          {t("shareAndroidVersion")}
        </button>
      </div>
    </section>
  );
}
