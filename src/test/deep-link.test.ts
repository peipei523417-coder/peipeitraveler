import { describe, it, expect } from "vitest";
import { parseShareDeepLink } from "@/lib/deep-link";

const ID = "9f109586-0a95-4f52-9b23-b7134784a02a";

describe("parseShareDeepLink", () => {
  it("HTTPS App Link / Universal Link", () => {
    expect(parseShareDeepLink(`https://peipeigotravel.lovable.app/share/${ID}`)).toBe(ID);
    expect(parseShareDeepLink(`https://peipeigotravel.lovable.app/share/${ID}/`)).toBe(ID);
    expect(parseShareDeepLink(`https://peipeigotravel.lovable.app/share/${ID}?x=1`)).toBe(ID);
  });
  it("HTTPS hash route", () => {
    expect(parseShareDeepLink(`https://peipeigotravel.lovable.app/#/share/${ID}`)).toBe(ID);
  });
  it("custom scheme share (Android + iOS)", () => {
    expect(parseShareDeepLink(`com.peitravel.smartplanner://share/${ID}`)).toBe(ID);
    expect(parseShareDeepLink(`com.peipeigo.travel://share/${ID}`)).toBe(ID);
  });
  it("OAuth callbacks are not share links", () => {
    expect(parseShareDeepLink("com.peitravel.smartplanner://auth/callback?access_token=a&refresh_token=b")).toBeNull();
    expect(parseShareDeepLink("com.peipeigo.travel://auth/callback?code=xyz")).toBeNull();
    expect(parseShareDeepLink("com.peitravel.smartplanner://oauth-callback?code=xyz")).toBeNull();
  });
  it("non-share URLs", () => {
    expect(parseShareDeepLink("https://peipeigotravel.lovable.app/")).toBeNull();
    expect(parseShareDeepLink("https://peipeigotravel.lovable.app/share/")).toBeNull();
  });
});
