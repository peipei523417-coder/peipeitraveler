import { describe, it, expect } from "vitest";
import { buildTimedPairs, formatInterval, buildRouteUrl } from "@/lib/route-pair";

describe("A→B timed pairs", () => {
  it("skips untimed items between A and B", () => {
    const p = buildTimedPairs([
      { id: "a", startTime: "09:00" },
      { id: "x" },
      { id: "y", startTime: "" },
      { id: "b", startTime: "12:00" },
    ]);
    expect(p).toEqual([{ fromId: "a", toId: "b", minutes: 180 }]);
    expect(formatInterval(180)).toBe("3時");
  });
  it("one or zero timed items → no pairs", () => {
    expect(buildTimedPairs([{ id: "a", startTime: "09:00" }, { id: "x" }])).toEqual([]);
    expect(buildTimedPairs([{ id: "x" }, { id: "y" }])).toEqual([]);
  });
  it("time going backwards or equal is not shown", () => {
    expect(buildTimedPairs([{ id: "a", startTime: "12:00" }, { id: "b", startTime: "09:00" }])).toEqual([]);
    expect(buildTimedPairs([{ id: "a", startTime: "09:00" }, { id: "b", startTime: "09:00" }])).toEqual([]);
  });
  it("formats minutes", () => {
    expect(formatInterval(10)).toBe("10分");
    expect(formatInterval(60)).toBe("1時");
    expect(formatInterval(150)).toBe("2時30分");
  });
});

describe("route url", () => {
  const A = "https://www.google.com/maps/place/Taipei+101/@25.03,121.56,17z/data=!3d25.0339639!4d121.5644722";
  const B = "https://www.google.com/maps/place/Din+Tai+Fung/@25.0,121.5,17z";
  it("two Google links with places → directions", () => {
    expect(buildRouteUrl(A, B)).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=25.0339639%2C121.5644722&destination=Din%20Tai%20Fung",
    );
  });
  it("short links, Naver, Amap, missing → no route", () => {
    expect(buildRouteUrl(A, "https://maps.app.goo.gl/abc")).toBeNull();
    expect(buildRouteUrl(A, "https://map.naver.com/p/entry/place/123")).toBeNull();
    expect(buildRouteUrl("https://uri.amap.com/marker?position=121,25", A)).toBeNull();
    expect(buildRouteUrl(A, undefined)).toBeNull();
    expect(buildRouteUrl(undefined, A)).toBeNull();
    expect(buildRouteUrl(A, "not a url")).toBeNull();
  });
});
