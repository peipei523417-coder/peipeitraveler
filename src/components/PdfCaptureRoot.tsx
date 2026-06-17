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

export interface CapturedDay {
  dayNumber: number;
  date: string;
  /** image/jpeg data URL of the day */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  mapLinks: CapturedMapLink[];
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

function weekday(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY[d.getDay()] ?? "";
}

async function waitImages(root: HTMLElement, overallTimeoutMs = 12000): Promise<void> {
  const start = Date.now();
  // Poll until the set of <img> elements is stable AND all complete, or until timeout.
  let lastCount = -1;
  let stableTicks = 0;
  while (Date.now() - start < overallTimeoutMs) {
    const imgs = Array.from(root.querySelectorAll("img"));
    const count = imgs.length;
    const allDone = imgs.every((img) => img.complete);
    if (count === lastCount && allDone) {
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
}

export function PdfCaptureRoot({ project, onReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    (async () => {
      const root = ref.current;
      if (!root) {
        onReady([]);
        return;
      }
      try {
        // Let React paint
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        // Wait for fonts
        try {
          const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
          if (fonts?.ready) await fonts.ready;
        } catch {
          /* ignore */
        }
        // Wait for images
        await waitImages(root);
        // Settle layout
        await new Promise((r) => setTimeout(r, 200));
        if (cancelled) return;

        const html2canvas = (await import("html2canvas-pro")).default;
        const dayNodes = Array.from(
          root.querySelectorAll<HTMLElement>("[data-pdf-day]"),
        );
        const result: CapturedDay[] = [];
        for (const node of dayNodes) {
          if (cancelled) return;
          const dayNumber = Number(node.dataset.pdfDay);
          const date = node.dataset.pdfDate || "";
          // Compute map link rects relative to this node BEFORE capture
          const nodeRect = node.getBoundingClientRect();
          const mapBtns = Array.from(
            node.querySelectorAll<HTMLElement>("[data-pdf-map-url]"),
          );
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
            const canvas = await html2canvas(node, {
              backgroundColor: "#ffffff",
              scale: Math.min(2, window.devicePixelRatio || 1.5),
              useCORS: true,
              allowTaint: false,
              logging: false,
              imageTimeout: 8000,
            });
            dataUrl = canvas.toDataURL("image/jpeg", 0.88);
            widthPx = canvas.width;
            heightPx = canvas.height;
          } catch (e) {
            console.warn("[pdf-capture] html2canvas failed for day", dayNumber, e);
          }
          result.push({ dayNumber, date, dataUrl, widthPx, heightPx, mapLinks });
        }
        if (!cancelled) onReady(result);
      } catch (e) {
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
        left: "-10000px",
        top: 0,
        width: 760,
        background: "#ffffff",
        zIndex: -1,
        pointerEvents: "none",
      }}
    >
      <div ref={ref} style={{ width: 760, background: "#ffffff" }}>
        {itinerary.map((day) => (
          <div
            key={day.dayNumber}
            data-pdf-day={day.dayNumber}
            data-pdf-date={fmtDate(day.date)}
            style={{
              width: 760,
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
