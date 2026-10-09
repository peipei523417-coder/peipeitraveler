import { describe, it, expect, beforeEach } from "vitest";
import { savePendingJoin, readPendingJoin, clearPendingJoin, PENDING_JOIN_TTL_MS } from "@/lib/pending-join";

const ID = "9f109586-0a95-4f52-9b23-b7134784a02a";

describe("pending share join", () => {
  beforeEach(() => localStorage.clear());

  it("never stores a password", () => {
    savePendingJoin(ID, "editor", 1000);
    const raw = localStorage.getItem("pending_share_join")!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["role", "shareCode", "ts"]);
  });

  it("restores share code and role after login", () => {
    savePendingJoin(ID, "editor", 1000);
    expect(readPendingJoin(2000)).toEqual({ shareCode: ID, role: "editor", ts: 1000 });
  });

  it("expires after 30 minutes", () => {
    savePendingJoin(ID, "viewer", 0);
    expect(readPendingJoin(PENDING_JOIN_TTL_MS + 1)).toBeNull();
  });

  it("rejects tampered share codes", () => {
    localStorage.setItem("pending_share_join", JSON.stringify({ shareCode: "../x", role: "editor", ts: 0 }));
    expect(readPendingJoin(1)).toBeNull();
  });

  it("clear removes it", () => {
    savePendingJoin(ID, "viewer", 0);
    clearPendingJoin();
    expect(readPendingJoin(1)).toBeNull();
  });
});
