import { describe, it, expect } from "vitest";
import { buildPromoMessage } from "@/components/RecommendAppCard";
import { IOS_APP_STORE_URL, ANDROID_PLAY_STORE_URL } from "@/config/storeLinks";
import { translations } from "@/i18n/translations";

describe("recommend app share", () => {
  it("store URLs match the published apps", () => {
    expect(IOS_APP_STORE_URL).toBe("https://apps.apple.com/app/id6761007171");
    expect(ANDROID_PLAY_STORE_URL).toBe("https://play.google.com/store/apps/details?id=com.peitravel.smartplanner");
  });
  it("zh-TW message: three final lines, one blank line, then the store URL", () => {
    const lines = buildPromoMessage(ANDROID_PLAY_STORE_URL).split("\n");
    expect(lines).toEqual([
      "✈️ PeiTravel 免費規劃旅行",
      "🗺️📍 整合地圖導航",
      "✨ 不用再傳截圖，一起編輯行程，分享超方便！",
      "",
      ANDROID_PLAY_STORE_URL,
    ]);
  });
  it("zh-TW i18n promo text equals the final approved copy", () => {
    expect(buildPromoMessage(IOS_APP_STORE_URL, translations["zh-TW"].translation.promoText)).toBe(
      buildPromoMessage(IOS_APP_STORE_URL),
    );
  });
  it("every language has a three-line promo text and a share title", () => {
    for (const [lang, v] of Object.entries(translations)) {
      const tr = (v as { translation: Record<string, string> }).translation;
      expect(tr.promoText?.split("\n").length, lang).toBe(3);
      expect(tr.recommendTitle, lang).toBeTruthy();
    }
  });
});
