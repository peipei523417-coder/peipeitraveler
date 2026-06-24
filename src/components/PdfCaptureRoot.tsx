/**
 * Offscreen renderer used during PDF export.
 *
 * Renders every PDF page as a DOM node so the exporter can html2canvas →
 * JPEG → embed sequentially. NO text is drawn through pdf-lib — that means
 * no font embedding, no CJK fallback, no encoding bugs.
 *
 * Page order (matches PDF):
 *   1. cover               — [data-pdf-cover]
 *   2. overview            — [data-pdf-overview]
 *   3. day 1..N            — [data-pdf-day=N]
 *   4. map links section   — [data-pdf-maplinks]   (cards: [data-pdf-link=URL])
 *   5. end page            — [data-pdf-end]
 */
import { useEffect, useRef } from "react";
import { TravelProject, ItineraryItem } from "@/types/travel";
import { ItineraryList, calculateDayTotal } from "@/components/ItineraryList";
import { sanitizeMapUrl, getMapProviderLabel } from "@/utils/mapLink";

export interface CapturedCardBounds {
  topPct: number;
  bottomPct: number;
}

export interface CapturedDay {
  dayNumber: number;
  date: string;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  cardBounds: CapturedCardBounds[];
}

interface Props {
  project: TravelProject;
  coverImageUrl?: string;
  endLogoUrl?: string;
  onReady: (root: HTMLElement | null, error?: unknown) => void;
}

export const PDF_CAPTURE_WIDTH = 760;

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function weekday(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY[d.getUTCDay()] ?? "";
}

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
  console.warn("[pdf-capture] images settled by timeout");
}

interface MapLinkEntry {
  dayNumber: number;
  date: string;
  title: string;
  url: string;
  provider: string;
}

function collectAllMapLinks(project: TravelProject): MapLinkEntry[] {
  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  const out: MapLinkEntry[] = [];
  for (const day of itinerary) {
    const items = Array.isArray(day.items) ? day.items : [];
    for (const item of items) {
      const source = item as ItineraryItem & {
        title?: unknown;
        name?: unknown;
        map_url?: unknown;
        location_url?: unknown;
      };
      const rawUrl = item.googleMapsUrl || String(source.map_url || source.location_url || "");
      const url = sanitizeMapUrl(rawUrl);
      if (!url) continue;
      const rawTitle = String(source.title || source.name || item.description || "").replace(/\s+$/g, "");
      out.push({
        dayNumber: day.dayNumber,
        date: fmtDate(day.date),
        title: rawTitle || "景點連結",
        url,
        provider: getMapProviderLabel(url),
      });
    }
  }
  return out;
}

function getMapButtonText(provider: string): string {
  if (provider === "高德地圖") return "開啟 高德地圖 ↗";
  if (provider === "Naver Map") return "開啟 Naver Map ↗";
  if (provider === "Google Maps") return "開啟 Google Maps ↗";
  return "開啟地圖 ↗";
}

export function PdfCaptureRoot({ project, coverImageUrl, endLogoUrl, onReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const runId = ++runIdRef.current;

    (async () => {
      const root = ref.current;
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
        } catch (e) {
          console.warn("[pdf-capture] fonts ready timeout; continuing", e);
        }
        const expectedPhotoCount =
          (Array.isArray(project.itinerary) ? project.itinerary : []).reduce(
            (sum, day) => sum + (Array.isArray(day.items) ? day.items.filter((item) => !!item.imageUrl).length : 0),
            0,
          ) + (coverImageUrl ? 1 : 0) + (endLogoUrl ? 1 : 0);
        await waitImages(root, 9000, expectedPhotoCount);
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

  const fontStack =
    '"Noto Sans TC", "PingFang TC", "Hiragino Sans", "Microsoft JhengHei", system-ui, sans-serif';

  const mapLinks = collectAllMapLinks(project);
  const linksByDay = new Map<number, MapLinkEntry[]>();
  for (const ml of mapLinks) {
    const arr = linksByDay.get(ml.dayNumber) ?? [];
    arr.push(ml);
    linksByDay.set(ml.dayNumber, arr);
  }
  const sortedDayNumbersWithLinks = Array.from(linksByDay.keys()).sort((a, b) => a - b);

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
        {/* ====== 1. COVER ====== */}
        <div
          data-pdf-cover
          style={{
            width: PDF_CAPTURE_WIDTH,
            padding: "40px 36px 44px",
            boxSizing: "border-box",
            background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 70%)",
            fontFamily: fontStack,
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
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999, background: "#0285c7" }} />
            PeiTravel
          </div>

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
                  background: "linear-gradient(135deg, #cfe7f8 0%, #dbeafe 50%, #ede9fe 100%)",
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

              <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { k: "總天數", v: `${totalDays} 天` },
                  { k: "行程數", v: `${totalItems} 項` },
                ].map((s) => (
                  <div key={s.k} style={{ background: "#f1f7fd", borderRadius: 14, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{s.k}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>{s.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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

          <div style={{ marginTop: 22, fontSize: 11, color: "#94a3b8", textAlign: "right" }}>
            由 PeiTravel App 匯出
          </div>
        </div>

        {/* ====== 2. OVERVIEW (📍 行程總覽) — compact itinerary outline ====== */}
        <div
          data-pdf-overview
          style={{
            width: PDF_CAPTURE_WIDTH,
            padding: "36px 36px 40px",
            boxSizing: "border-box",
            background: "#ffffff",
            fontFamily: fontStack,
            color: "#0f172a",
          }}
        >
          <div style={{ fontSize: 26, fontWeight: 800, color: "#0285c7", marginBottom: 6 }}>📍 行程總覽</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
            {project.name || "未命名行程"}
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
            {fmtDate(project.startDate)} － {fmtDate(project.endDate)}
          </div>

          {itinerary.map((day) => {
            const items = Array.isArray(day.items) ? day.items : [];
            const cleaned = items
              .map((i) => {
                const raw = String((i as unknown as { title?: string }).title || i.description || "")
                  .replace(/\s+/g, " ")
                  .trim();
                return { time: i.startTime || "", title: raw };
              })
              .filter((row) => {
                if (!row.title) return false;
                // Skip purely numeric / symbol-only / test placeholder rows
                if (/^[\d\s\p{P}\p{S}]+$/u.test(row.title)) return false;
                if (/^(test|測試)/i.test(row.title)) return false;
                return true;
              })
              .map((row) => ({
                time: row.time,
                title: row.title.length > 20 ? row.title.slice(0, 20) + "…" : row.title,
              }));
            if (cleaned.length === 0) return null;
            return (
              <div key={day.dayNumber} data-pdf-card style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0285c7", marginBottom: 6 }}>
                  Day {day.dayNumber}
                  <span style={{ color: "#94a3b8", fontWeight: 500, marginLeft: 8, fontSize: 12 }}>
                    {fmtDate(day.date)}
                  </span>
                </div>
                {cleaned.map((row, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: 13,
                      color: "#0f172a",
                      lineHeight: 1.6,
                      paddingLeft: 4,
                      display: "flex",
                      gap: 10,
                    }}
                  >
                    {row.time && (
                      <span style={{ color: "#64748b", minWidth: 42, fontVariantNumeric: "tabular-nums" }}>
                        {row.time}
                      </span>
                    )}
                    <span style={{ flex: 1, wordBreak: "break-word" }}>{row.title}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* ====== 3. DAYS ====== */}
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
              fontFamily: fontStack,
            }}
          >
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0285c7", lineHeight: 1.2 }}>
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

        {/* ====== 4. MAP LINKS (consolidated) ====== */}
        {mapLinks.length > 0 && (
          <div
            data-pdf-maplinks
            style={{
              width: PDF_CAPTURE_WIDTH,
              padding: "36px 32px 40px",
              background: "#ffffff",
              boxSizing: "border-box",
              fontFamily: fontStack,
              color: "#0f172a",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 800, color: "#0285c7", marginBottom: 4 }}>
              {project.name || "行程"} 導航連結
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 22 }}>
              點擊卡片即可開啟導航
            </div>

            {sortedDayNumbersWithLinks.map((dayNum) => {
              const links = linksByDay.get(dayNum) ?? [];
              const dayDateStr = (() => {
                const d = itinerary.find((x) => x.dayNumber === dayNum)?.date;
                return d ? fmtDate(d) : "";
              })();
              return (
                <div key={dayNum} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0285c7", margin: "8px 0 10px" }}>
                    Day {dayNum}
                    {dayDateStr && (
                      <span style={{ color: "#94a3b8", fontWeight: 500, marginLeft: 8 }}>｜{dayDateStr}</span>
                    )}
                  </div>
                  {links.map((link, idx) => (
                    <div
                      key={`${dayNum}-${idx}`}
                      data-pdf-card
                      data-pdf-link={link.url}
                      style={{
                        background: "#f8fbff",
                        border: "1px solid #d6e6f5",
                        borderRadius: 14,
                        padding: "14px 16px",
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#0f172a",
                          whiteSpace: "pre-line",
                          marginBottom: 10,
                          lineHeight: 1.4,
                        }}
                      >
                        📍 {link.title}
                      </div>
                      <div
                        style={{
                          display: "inline-block",
                          background: "#0285c7",
                          color: "#ffffff",
                          fontSize: 13,
                          fontWeight: 700,
                          padding: "9px 18px",
                          borderRadius: 999,
                        }}
                      >
                        {getMapButtonText(link.provider)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* ====== 5. END PAGE ====== */}
        <div
          data-pdf-end
          style={{
            width: PDF_CAPTURE_WIDTH,
            height: 1040,
            background: "#ffffff",
            boxSizing: "border-box",
            fontFamily: fontStack,
            color: "#0f172a",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px 36px",
          }}
        >
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1f2937",
              marginBottom: 22,
              letterSpacing: 1,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ marginLeft: -8 }}>🎉</span>
            <span>旅途順利</span>
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 56 }}>
            此行程由 PeiTravel App 匯出完成
          </div>
          {endLogoUrl && (
            <img
              src={endLogoUrl}
              data-pdf-photo
              crossOrigin="anonymous"
              alt=""
              style={{ width: 64, height: 64, marginBottom: 18, display: "block", objectFit: "contain", borderRadius: 14 }}
            />
          )}
          <div
            style={{
              fontSize: 34,
              fontWeight: 900,
              color: "#000000",
              letterSpacing: 1,
              fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
            }}
          >
            PeiTravel
          </div>
        </div>
      </div>
    </div>
  );
}

export { calculateDayTotal };
