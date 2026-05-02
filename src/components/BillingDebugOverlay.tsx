import { useEffect, useState } from "react";

/**
 * BillingDebugOverlay — on-screen viewer for [Billing][DIAG] logs.
 *
 * Activation:
 *   - Add ?debug=billing to URL, OR
 *   - localStorage.setItem("debug_billing", "1")
 *
 * Tap the floating chip to expand/collapse. Tap "Clear" to reset.
 */
type Entry = { level: "log" | "warn" | "error"; time: string; text: string };

const MAX_ENTRIES = 100;

function isEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (window.location.search.includes("debug=billing")) return true;
    if (window.location.hash.includes("debug=billing")) return true;
    return localStorage.getItem("debug_billing") === "1";
  } catch {
    return false;
  }
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

export function BillingDebugOverlay() {
  const [enabled] = useState(isEnabled);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const orig = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };

    const intercept = (level: Entry["level"], fn: (...a: any[]) => void) =>
      (...args: any[]) => {
        try {
          const text = format(args);
          if (text.includes("[Billing]")) {
            const time = new Date().toLocaleTimeString();
            setEntries((prev) => {
              const next = [...prev, { level, time, text }];
              return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
          }
        } catch {
          // never break the app
        }
        fn(...args);
      };

    console.log = intercept("log", orig.log);
    console.warn = intercept("warn", orig.warn);
    console.error = intercept("error", orig.error);

    return () => {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        zIndex: 999999,
        maxWidth: "min(92vw, 460px)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.35,
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
          padding: "6px 10px",
          borderRadius: 8,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        <span>🧾 Billing DIAG ({entries.length})</span>
        <span>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div
          style={{
            marginTop: 6,
            background: "rgba(0,0,0,0.85)",
            color: "#e5e7eb",
            borderRadius: 8,
            padding: 8,
            maxHeight: "45vh",
            overflowY: "auto",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ color: "#fbbf24" }}>Billing logs</strong>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEntries([]);
              }}
              style={{
                background: "transparent",
                color: "#9ca3af",
                border: "1px solid #374151",
                borderRadius: 4,
                padding: "1px 6px",
                cursor: "pointer",
                fontSize: 10,
              }}
            >
              Clear
            </button>
          </div>
          {entries.length === 0 ? (
            <div style={{ color: "#9ca3af" }}>Waiting for [Billing] logs…</div>
          ) : (
            entries.map((e, i) => (
              <div
                key={i}
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  borderTop: i === 0 ? "none" : "1px solid #1f2937",
                  paddingTop: i === 0 ? 0 : 4,
                  marginTop: i === 0 ? 0 : 4,
                  color:
                    e.level === "error"
                      ? "#fca5a5"
                      : e.level === "warn"
                      ? "#fcd34d"
                      : "#d1d5db",
                }}
              >
                <span style={{ color: "#6b7280" }}>[{e.time}]</span> {e.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
