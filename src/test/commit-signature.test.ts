import { describe, it, expect } from "vitest";
import { normalizeTimestamp, signatureKey } from "@/lib/commit-signature";
describe("commit signature", () => {
  it("matches PostgREST and Realtime formats", () => {
    const a = normalizeTimestamp("2026-10-03T17:32:01.12345+00:00");
    expect(a).toBe("2026-10-03T17:32:01.123450+00:00");
    expect(normalizeTimestamp("2026-10-03 17:32:01.12345+00")).toBe(a);
    expect(normalizeTimestamp("2026-10-04T01:32:01.12345+08:00")).toBe(a);
    expect(normalizeTimestamp("2026-10-03T17:32:01.12345Z")).toBe(a);
  });
  it("keeps microsecond precision", () => {
    expect(signatureKey("x", "2026-10-03T17:32:01.123451+00:00")).not.toBe(signatureKey("x", "2026-10-03T17:32:01.123452+00:00"));
    expect(signatureKey("x", undefined)).toBeNull();
  });
});
