import { describe, it, expect } from "vitest";
import { buildPromoMessage } from "@/components/RecommendAppCard";
import { IOS_APP_STORE_URL, ANDROID_PLAY_STORE_URL } from "@/config/storeLinks";

describe("recommend app share", () => {
  it("store URLs match the published apps", () => {
    expect(IOS_APP_STORE_URL).toBe("https://apps.apple.com/app/id6761007171");
    expect(ANDROID_PLAY_STORE_URL).toBe("https://play.google.com/store/apps/details?id=com.peitravel.smartplanner");
  });
  it("message has three promo lines then the store URL", () => {
    const lines = buildPromoMessage(IOS_APP_STORE_URL).split("\n");
    expect(lines).toEqual([
      "✈️ 下載 PeiTravel 免費規劃旅行！",
      "❤️ 一起編輯行程、整合導航",
      "旅行不用再傳一堆截圖，行程分享超方便！✨",
      IOS_APP_STORE_URL,
    ]);
  });
});
