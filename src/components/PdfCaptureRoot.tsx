/**
 * Offscreen renderer used during PDF export.
 *
 * Renders a card-style cover + every Day of a project at a fixed width
 * (PDF-friendly), waits for fonts + images to be ready, then
 * html2canvas-captures each node.
 *
 * The cover snapshot is returned with dayNumber = 0 (sentinel).
 *
 * The container is positioned far off-screen so it never affects the live UI.
 */
import { useEffect, useRef } from "react";
import { TravelProject } from "@/types/travel";
import { ItineraryList, calculateDayTotal } from "@/components/ItineraryList";

export interface CapturedMapLink {
  url: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface CapturedCardBounds {
  topPct: number;
  bottomPct: number;
}

export interface CapturedDay {
  /** 0 = cover snapshot, 1..N = actual day */
  dayNumber: number;
  date: string;
  /** image/jpeg data URL */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  mapLinks: CapturedMapLink[];
  cardBounds: CapturedCardBounds[];
}

interface Props {
  project: TravelProject;
  /** Pre-signed cover image URL (so html2canvas can fetch it). */
  coverImageUrl?: string;
  onReady: (days: CapturedDay[] | null, error?: unknown) => void;
}

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
const CAPTURE_WIDTH = 760;
const HTML2CANVAS_TIMEOUT_MS = 18000;

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
      console.info("[pdf-capture] capture start", { hasRoot: !!root, runId });
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

        let html2canvas: typeof import("html2canvas-pro").default;
        try {
          html2canvas = await withTimeout(
            import("html2canvas-pro").then((m) => m.default),
            8000,
            "html2canvas-pro import",
          );
          console.info("[pdf-capture] html2canvas loaded");
        } catch (e) {
          console.error("[pdf-capture] html2canvas-pro import failed", e);
          if (!cancelled) onReady(null, e);
          return;
        }

        const captureNode = async (node: HTMLElement, label: string): Promise<{ dataUrl: string; w: number; h: number } | null> => {
          const rect = node.getBoundingClientRect();
          try {
            const canvasPromise = html2canvas(node, {
              backgroundColor: "#ffffff",
              scale: 2,
              useCORS: true,
              allowTaint: false,
              logging: false,
              imageTimeout: 6000,
              windowWidth: CAPTURE_WIDTH,
              width: Math.ceil(node.scrollWidth || rect.width || CAPTURE_WIDTH),
              height: Math.ceil(node.scrollHeight || rect.height || 1),
              scrollX: 0,
              scrollY: 0,
            });
            const canvas = await withTimeout(canvasPromise, HTML2CANVAS_TIMEOUT_MS, label);
            return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), w: canvas.width, h: canvas.height };
          } catch (e) {
            console.warn("[pdf-capture] capture failed", label, e);
            return null;
          }
        };

        const result: CapturedDay[] = [];

        // Cover
        const coverNode = root.querySelector<HTMLElement>("[data-pdf-cover]");
        if (coverNode) {
          console.info("[pdf-capture] capture cover");
          const shot = await captureNode(coverNode, "capture cover");
          if (shot) {
            result.push({
              dayNumber: 0,
              date: "",
              dataUrl: shot.dataUrl,
              widthPx: shot.w,
              heightPx: shot.h,
              mapLinks: [],
              cardBounds: [],
            });
          }
        }

        // Days
        const dayNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-day]"));
        console.info("[pdf-capture] day nodes found", { count: dayNodes.length });
        for (const node of dayNodes) {
          if (cancelled || runId !== runIdRef.current) return;
          const dayNumber = Number(node.dataset.pdfDay);
          const date = node.dataset.pdfDate || "";
          const nodeRect = node.getBoundingClientRect();
          const cardBounds = Array.from(node.querySelectorAll<HTMLElement>("[data-pdf-card]")).map((card) => {
            const r = card.getBoundingClientRect();
            return {
              topPct: (r.top - nodeRect.top) / nodeRect.height,
              bottomPct: (r.bottom - nodeRect.top) / nodeRect.height,
            };
          });

          const shot = await captureNode(node, `capture day${dayNumber}`);
          if (shot) {
            console.info(`[pdf-capture] day${dayNumber} canvas`, {
              width: shot.w, height: shot.h, fileSizeKb: Math.round(shot.dataUrl.length / 1024),
            });
            result.push({
              dayNumber, date, dataUrl: shot.dataUrl,
              widthPx: shot.w, heightPx: shot.h, mapLinks: [], cardBounds,
            });
          } else {
            result.push({
              dayNumber, date, dataUrl: "", widthPx: 0, heightPx: 0, mapLinks: [], cardBounds: [],
            });
          }
        }
        console.info("[pdf-capture] capture complete", { snapshots: result.length });
        if (!cancelled && runId === runIdRef.current) onReady(result);
      } catch (e) {
        console.error("[pdf-capture] capture failed", e);
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
  const maxPersons = allItems.reduce((m, i) => Math.max(m, i.persons || 1), 1);
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
        width: CAPTURE_WIDTH,
        background: "#ffffff",
        visibility: "visible",
        opacity: 1,
        pointerEvents: "none",
      }}
    >
      <div ref={ref} style={{ width: CAPTURE_WIDTH, background: "#ffffff" }}>
        {/* ====== COVER (card-style, matches lobby project card) ====== */}
        <div
          data-pdf-cover
          style={{
            width: CAPTURE_WIDTH,
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
              width: CAPTURE_WIDTH,
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
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                {weekday(day.date)}
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
