/**
 * Offscreen renderer used during PDF export.
 *
 * IMPORTANT: This component does NOT capture snapshots. It only mounts the
 * DOM (cover card + every Day) far off-screen, waits for fonts/images to
 * settle, then hands the root element back to the caller via onReady.
 *
 * The PDF export module (`src/lib/pdf-export.ts`) walks the root and
 * captures one node at a time, embeds it into the PDF immediately, and
 * releases the canvas before moving on. This guarantees only ONE large
 * canvas/image exists in memory at a time — critical for mobile reliability.
 */
import { useEffect, useRef } from "react";
import { TravelProject } from "@/types/travel";
import { ItineraryList, calculateDayTotal } from "@/components/ItineraryList";

export interface CapturedCardBounds {
  topPct: number;
  bottomPct: number;
}

/** Returned by sequential capture in pdf-export. */
export interface CapturedDay {
  /** 0 = cover snapshot, 1..N = actual day */
  dayNumber: number;
  date: string;
  /** image/jpeg data URL */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  cardBounds: CapturedCardBounds[];
}

interface Props {
  project: TravelProject;
  /** Pre-signed cover image URL (so html2canvas can fetch it). */
  coverImageUrl?: string;
  /** Called once DOM is mounted and fonts/images have settled. */
  onReady: (root: HTMLElement | null, error?: unknown) => void;
}

export const PDF_CAPTURE_WIDTH = 760;

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function weekday(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY[d.getUTCDay()] ?? "";
}

async function waitImages(root: HTMLElement, overallTimeoutMs = 12000, expectedPhotoCount = 0): Promise<void> {
  const start = Date.now();
  let lastCount = -1;
  let stableTicks = 0;
  while (Date.now() - start < overallTimeoutMs) {
    const imgs = Array.from(root.querySelectorAll("img"));
    const photoCount = root.querySelectorAll("img[data-pdf-photo]").length;
    const count = imgs.length;
    const enoughPhotos = photoCount >= expectedPhotoCount;
    const allDone = imgs.every((img) => img.complete);
    if (count === lastCount && enoughPhotos && allDone) {
      stableTicks++;
      if (stableTicks >= 2) {
        await Promise.all(
          imgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete) return resolve();
                const finish = () => resolve();
                img.addEventListener("load", finish, { once: true });
                img.addEventListener("error", finish, { once: true });
                setTimeout(finish, 4000);
              }),
          ),
        );
        return;
      }
    } else {
      stableTicks = 0;
    }
    lastCount = count;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.warn("[pdf-capture] images settled by timeout; continuing", {
    expectedPhotoCount,
    actualPhotoCount: root.querySelectorAll("img[data-pdf-photo]").length,
    totalImages: root.querySelectorAll("img").length,
  });
}

export function PdfCaptureRoot({ project, coverImageUrl, onReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const runId = ++runIdRef.current;

    (async () => {
      const root = ref.current;
      console.info("[pdf-capture] mount", { hasRoot: !!root, runId });
      if (!root) {
        onReady(null, new Error("PdfCaptureRoot mounted without root element"));
        return;
      }
      try {
        await withTimeout(
          new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
          3000,
          "capture frame wait",
        );
        try {
          const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
          if (fonts?.ready) await withTimeout(fonts.ready, 5000, "document.fonts.ready");
          console.info("[pdf-capture] fonts ready");
        } catch (e) {
          console.warn("[pdf-capture] fonts ready timeout/fail; continuing", e);
        }
        const expectedPhotoCount =
          (Array.isArray(project.itinerary) ? project.itinerary : []).reduce(
            (sum, day) => sum + (Array.isArray(day.items) ? day.items.filter((item) => !!item.imageUrl).length : 0),
            0,
          ) + (coverImageUrl ? 1 : 0);
        await waitImages(root, 9000, expectedPhotoCount);
        console.info("[pdf-capture] images settled");
        await new Promise((r) => setTimeout(r, 150));
        if (cancelled || runId !== runIdRef.current) return;
        onReady(root);
      } catch (e) {
        console.error("[pdf-capture] mount/settle failed", e);
        if (!cancelled) onReady(null, e);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  const allItems = itinerary.flatMap((d) => (Array.isArray(d?.items) ? d.items : []));
  const totalRaw = allItems.reduce((s, i) => s + (i.price ?? 0), 0);
  const totalPerPerson = allItems.reduce((s, i) => {
    if (!i.price || i.price <= 0) return s;
    return s + Math.round(i.price / (i.persons || 1));
  }, 0);
  const totalDays = (() => {
    const sd = project.startDate instanceof Date ? project.startDate : new Date(project.startDate as unknown as string);
    const ed = project.endDate instanceof Date ? project.endDate : new Date(project.endDate as unknown as string);
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return itinerary.length || 0;
    return Math.round((ed.getTime() - sd.getTime()) / 86400000) + 1;
  })();
  const totalItems = allItems.length;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: -10000,
        top: 0,
        width: PDF_CAPTURE_WIDTH,
        background: "#ffffff",
        visibility: "visible",
        opacity: 1,
        pointerEvents: "none",
      }}
    >
      <div ref={ref} style={{ width: PDF_CAPTURE_WIDTH, background: "#ffffff" }}>
        {/* ====== COVER (card-style, matches lobby project card) ====== */}
        <div
          data-pdf-cover
          style={{
            width: PDF_CAPTURE_WIDTH,
            padding: "40px 36px 44px",
            boxSizing: "border-box",
            background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 70%)",
            fontFamily:
              '"Noto Sans TC", "PingFang TC", "Hiragino Sans", "Microsoft JhengHei", system-ui, sans-serif',
            color: "#0f172a",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#0285c7",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 1,
              marginBottom: 18,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "#0285c7",
              }}
            />
            PeiTravel
          </div>

          {/* Card */}
          <div
            style={{
              borderRadius: 24,
              overflow: "hidden",
              background: "#ffffff",
              boxShadow: "0 12px 36px rgba(15, 23, 42, 0.10)",
              border: "1px solid #e6eef7",
            }}
          >
            {coverImageUrl ? (
              <div style={{ width: "100%", height: 320, overflow: "hidden", background: "#e6eef7" }}>
                <img
                  src={coverImageUrl}
                  data-pdf-photo
                  crossOrigin="anonymous"
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>
            ) : (
              <div
                style={{
                  width: "100%",
                  height: 200,
                  background:
                    "linear-gradient(135deg, #cfe7f8 0%, #dbeafe 50%, #ede9fe 100%)",
                }}
              />
            )}
            <div style={{ padding: "26px 28px 28px" }}>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  lineHeight: 1.25,
                  color: "#0f172a",
                  wordBreak: "break-word",
                }}
              >
                {project.name || "未命名行程"}
              </div>
              <div style={{ fontSize: 14, color: "#475569", marginTop: 10 }}>
                {fmtDate(project.startDate)} － {fmtDate(project.endDate)}
              </div>

              {/* Stats grid — no 人數 on cover */}
              <div
                style={{
                  marginTop: 22,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {[
                  { k: "總天數", v: `${totalDays} 天` },
                  { k: "行程數", v: `${totalItems} 項` },
                ].map((s) => (
                  <div
                    key={s.k}
                    style={{
                      background: "#f1f7fd",
                      borderRadius: 14,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#64748b" }}>{s.k}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {s.v}
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div style={{ background: "#f1f7fd", borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, color: "#64748b" }}>總花費</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                    ${totalRaw.toLocaleString()}
                  </div>
                </div>
                <div style={{ background: "#f1f7fd", borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, color: "#64748b" }}>單人總花費</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#0285c7", marginTop: 4 }}>
                    ${totalPerPerson.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 22,
              fontSize: 11,
              color: "#94a3b8",
              textAlign: "right",
            }}
          >
            由 PeiTravel App 匯出
          </div>
        </div>

        {/* ====== DAYS ====== */}
        {itinerary.map((day) => (
          <div
            key={day.dayNumber}
            data-pdf-day={day.dayNumber}
            data-pdf-date={fmtDate(day.date)}
            style={{
              width: PDF_CAPTURE_WIDTH,
              padding: "28px 24px 32px",
              background: "#ffffff",
              boxSizing: "border-box",
              fontFamily:
                '"Noto Sans TC", "PingFang TC", "Hiragino Sans", "Microsoft JhengHei", system-ui, sans-serif',
            }}
          >
            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#0285c7",
                  lineHeight: 1.2,
                }}
              >
                Day {day.dayNumber}｜{fmtDate(day.date)}
                <span style={{ color: "#94a3b8", fontWeight: 500, marginLeft: 8 }}>
                  ({weekday(day.date)})
                </span>
              </div>
            </div>
            <ItineraryList
              day={day}
              readOnly
              isLastDay={false}
              onAddItem={() => {}}
              onEditItem={() => {}}
              onDeleteItem={() => {}}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// re-export so external callers can still use it
export { calculateDayTotal };
