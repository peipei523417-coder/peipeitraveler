/**
 * Pending share-join marker that survives a full-page OAuth redirect.
 * Stores ONLY the share code, requested role and a timestamp — never a
 * password. After login the share page re-asks for the edit password.
 */
export type PendingJoin = { shareCode: string; role: "editor" | "viewer"; ts: number };

const KEY = "pending_share_join";
export const PENDING_JOIN_TTL_MS = 30 * 60 * 1000;

export function savePendingJoin(shareCode: string, role: "editor" | "viewer", now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ shareCode, role, ts: now }));
  } catch { /* ignore */ }
}

export function readPendingJoin(now = Date.now()): PendingJoin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (
      !p || typeof p.shareCode !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(p.shareCode) ||
      (p.role !== "editor" && p.role !== "viewer") || typeof p.ts !== "number" ||
      now - p.ts > PENDING_JOIN_TTL_MS || now < p.ts - 60_000
    ) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { shareCode: p.shareCode, role: p.role, ts: p.ts };
  } catch {
    return null;
  }
}

export function clearPendingJoin() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
