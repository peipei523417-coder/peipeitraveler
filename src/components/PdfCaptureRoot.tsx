/**
 * Offscreen renderer used during PDF export.
 *
 * Renders every Day of a project at a fixed width (PDF-friendly), waits for
 * fonts + images to be ready, then html2canvas-captures each Day node and
 * collects map-link rects (for clickable PDF annotations).
 *
 * The container is positioned far off-screen so it never affects the live UI.
 */
import { useEffect, useRef } from "react";
import { TravelProject } from "@/types/travel";
import { ItineraryList } from "@/components/ItineraryList";

export interface CapturedMapLink {
  url: string;
  // Position relative to the day node (0-1 fractions, origin top-left).
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
  dayNumber: number;
  date: string;
  /** image/jpeg data URL of the day */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  mapLinks: CapturedMapLink[];
  cardBounds: CapturedCardBounds[];
}

interface Props {
  project: TravelProject;
  onReady: (days: CapturedDay[] | null, error?: unknown) => void;
}

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

const WEEKDAY = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
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
  return WEEKDAY[d.getDay()] ?? "";
}

async function waitImages(root: HTMLElement, overallTimeoutMs = 12000, expectedPhotoCount = 0): Promise<void> {
  const start = Date.now();
  // Poll until the set of <img> elements is stable AND all complete, or until timeout.
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
        // Wait final image loads (in case some just toggled complete)
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

export function PdfCaptureRoot({ project, onReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const runId = ++runIdRef.current;

    (async () => {
      const root = ref.current;
      console.info("capture start");
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
          console.info("fonts ready");
          console.info("[pdf-capture] fonts ready");
        } catch (e) {
          console.warn("[pdf-capture] fonts ready timeout/fail; continuing", e);
        }
        const expectedPhotoCount = (Array.isArray(project.itinerary) ? project.itinerary : []).reduce(
          (sum, day) => sum + (Array.isArray(day.items) ? day.items.filter((item) => !!item.imageUrl).length : 0),
          0,
        );
        await waitImages(root, 9000, expectedPhotoCount);
        console.info("images settled");
        console.info("[pdf-capture] images settled");
        await new Promise((r) => setTimeout(r, 150));
        if (cancelled || runId !== runIdRef.current) return;

        console.info("[pdf-capture] loading html2canvas-pro…");
        let html2canvas: typeof import("html2canvas-pro").default;
        try {
          html2canvas = await withTimeout(
            import("html2canvas-pro").then((m) => m.default),
            8000,
            "html2canvas-pro import",
          );
          console.info("html2canvas loaded");
          console.info("[pdf-capture] html2canvas loaded");
        } catch (e) {
          console.error("[pdf-capture] html2canvas-pro import failed", e);
          if (!cancelled) onReady(null, e);
          return;
        }

        const dayNodes = Array.from(
          root.querySelectorAll<HTMLElement>("[data-pdf-day]"),
        );
        console.info("[pdf-capture] day nodes found", { count: dayNodes.length });
        const result: CapturedDay[] = [];
        for (const node of dayNodes) {
          if (cancelled || runId !== runIdRef.current) return;
          const dayNumber = Number(node.dataset.pdfDay);
          const date = node.dataset.pdfDate || "";
          console.info(`capture day${dayNumber}`);
          console.info("[pdf-capture] capture day", { dayNumber, date });
          const nodeRect = node.getBoundingClientRect();
          const mapBtns = Array.from(
            node.querySelectorAll<HTMLElement>("[data-pdf-map-url]"),
          );
          const cardBounds = Array.from(node.querySelectorAll<HTMLElement>("[data-pdf-card]")).map((card) => {
            const r = card.getBoundingClientRect();
            return {
              topPct: (r.top - nodeRect.top) / nodeRect.height,
              bottomPct: (r.bottom - nodeRect.top) / nodeRect.height,
            };
          });
          const mapLinks: CapturedMapLink[] = mapBtns.map((btn) => {
            const r = btn.getBoundingClientRect();
            return {
              url: btn.dataset.pdfMapUrl || "",
              xPct: (r.left - nodeRect.left) / nodeRect.width,
              yPct: (r.top - nodeRect.top) / nodeRect.height,
              wPct: r.width / nodeRect.width,
              hPct: r.height / nodeRect.height,
            };
          });

          let dataUrl = "";
          let widthPx = 0;
          let heightPx = 0;
          try {
            const canvasPromise = html2canvas(node, {
              backgroundColor: "#ffffff",
              scale: 2,
              useCORS: true,
              allowTaint: false,
              logging: false,
              imageTimeout: 6000,
              windowWidth: CAPTURE_WIDTH,
              width: Math.ceil(node.scrollWidth || nodeRect.width || CAPTURE_WIDTH),
              height: Math.ceil(node.scrollHeight || nodeRect.height || 1),
              scrollX: 0,
              scrollY: 0,
            });
            const canvas = await withTimeout(canvasPromise, HTML2CANVAS_TIMEOUT_MS, `capture day${dayNumber}`);
            dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            widthPx = canvas.width;
            heightPx = canvas.height;
            console.info(`[pdf-capture] day${dayNumber} canvas`, {
              width: widthPx,
              height: heightPx,
              fileSizeKb: Math.round(dataUrl.length / 1024),
            });
            console.info("[pdf-capture] day captured", {
              dayNumber, widthPx, heightPx, kb: Math.round(dataUrl.length / 1024),
            });
          } catch (e) {
            console.warn("[pdf-capture] html2canvas failed for day", dayNumber, e);
          }
          result.push({ dayNumber, date, dataUrl, widthPx, heightPx, mapLinks, cardBounds });
        }
        console.info("capture complete");
        console.info("[pdf-capture] capture complete", { days: result.length });
        if (!cancelled && runId === runIdRef.current) onReady(result);
      } catch (e) {
        console.error("capture failed", e);
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
