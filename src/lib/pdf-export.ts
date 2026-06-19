/**
 * PDF export — "Cover + Day Snapshots" mode.
 *
 *  - Page 1: cover (PeiTravel branding, title, dates, cover photo, stats).
 *  - Page 2..N: one A4 page per Day, embedded JPG snapshot of the live UI.
 *    Each map button on the live UI gets a clickable PDF link annotation
 *    mapped to the same on-page position.
 *
 * This avoids re-laying out the itinerary in pdf-lib (which was losing text,
 * misordering items, and breaking emoji / CJK glyphs).
 */

import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  rgb,
  PDFName,
  PDFString,
  PDFArray,
  StandardFonts,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { TravelProject, ItineraryItem, DayItinerary } from "@/types/travel";
import { getSignedImageUrl } from "@/lib/supabase-storage";
import type { CapturedDay, CapturedCardBounds } from "@/components/PdfCaptureRoot";
import { PDF_CAPTURE_WIDTH } from "@/components/PdfCaptureRoot";
import { sanitizeMapUrl, getMapProviderLabel } from "@/utils/mapLink";

const HTML2CANVAS_TIMEOUT_MS = 18000;

// ---------- Fonts ----------
const FONT_REGULAR_URL =
  "https://github.com/googlefonts/noto-cjk/raw/main/Sans/Variable/TTF/Subset/NotoSansTC-VF.ttf";
const FONT_BOLD_URL =
  "https://github.com/googlefonts/noto-cjk/raw/main/Sans/Variable/TTF/Subset/NotoSansTC-VF.ttf";
const LOCAL_FONT_REGULAR_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Regular.otf`;
const LOCAL_FONT_BOLD_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Bold.otf`;
const ASSET_FONT_REGULAR_URL = "/__l5e/assets-v1/f9a6a994-72d6-49cc-9fdb-163b5ecc7077/NotoSansTC-Regular.ttf";
const ASSET_FONT_BOLD_URL = "/__l5e/assets-v1/3047ff04-e319-4a39-b924-4a2d955a196b/NotoSansTC-Bold.ttf";

const FONT_TIMEOUT_MS = 7000;
const FONT_EMBED_TIMEOUT_MS = 9000;
const SIGNED_URL_TIMEOUT_MS = 5000;
const IMAGE_FETCH_TIMEOUT_MS = 10000;
const IMAGE_EMBED_TIMEOUT_MS = 6000;
const PDF_SAVE_TIMEOUT_MS = 180000;
const SHARE_TIMEOUT_MS = 12000;

// A4
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CONTENT_H = PAGE_H - MARGIN * 2;

const PRIMARY = rgb(0.008, 0.522, 0.78);
const PRIMARY_LIGHT = rgb(0.86, 0.94, 0.99);
const TEXT = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.46, 0.55);

// ---------- Font loading ----------
let fontRegularBytes: ArrayBuffer | null = null;
let fontBoldBytes: ArrayBuffer | null = null;
let fontSource: "cdn" | "asset" | "local" = "cdn";

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

async function fetchBuffer(url: string, timeoutMs = FONT_TIMEOUT_MS): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "force-cache", signal: controller.signal });
    if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer; source: "cdn" | "asset" | "local" }> {
  if (!fontRegularBytes || !fontBoldBytes) {
    let r: ArrayBuffer;
    let b: ArrayBuffer;
    try {
      [r, b] = await Promise.all([
        fontRegularBytes ?? fetchBuffer(FONT_REGULAR_URL),
        fontBoldBytes ?? fetchBuffer(FONT_BOLD_URL),
      ]);
      fontSource = "cdn";
    } catch (e) {
      console.warn("[pdf-export] CDN font fetch failed; trying external asset fallback", e);
      try {
        [r, b] = await Promise.all([
          fontRegularBytes ?? fetchBuffer(ASSET_FONT_REGULAR_URL),
          fontBoldBytes ?? fetchBuffer(ASSET_FONT_BOLD_URL),
        ]);
        fontSource = "asset";
      } catch (assetError) {
        console.warn("[pdf-export] asset font fetch failed; trying bundled OTF fallback", assetError);
        [r, b] = await Promise.all([
          fontRegularBytes ?? fetchBuffer(LOCAL_FONT_REGULAR_URL),
          fontBoldBytes ?? fetchBuffer(LOCAL_FONT_BOLD_URL),
        ]);
        fontSource = "local";
      }
    }
    fontRegularBytes = r;
    fontBoldBytes = b;
  }
  return { regular: fontRegularBytes!, bold: fontBoldBytes!, source: fontSource };
}

export type PdfExportWarning = "font-fallback" | "image-skipped" | "day-snapshot-skipped";

async function embedPdfFonts(
  doc: PDFDocument,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
): Promise<{ font: PDFFont; fontBold: PDFFont; fallback: boolean }> {
  try {
    const { regular, bold, source } = await loadFonts();
    const [font, fontBold] = await withTimeout(
      Promise.all([
        doc.embedFont(regular, { subset: true }),
        doc.embedFont(bold, { subset: true }),
      ]),
      FONT_EMBED_TIMEOUT_MS,
      "font embed",
    );
    if (source === "local") onWarning?.("font-fallback", "bundled Noto Sans TC");
    console.info("[pdf-export] load font success", { source });
    return { font, fontBold, fallback: false };
  } catch (e) {
    console.warn("[pdf-export] load font fail; using Helvetica fallback", e);
    onWarning?.("font-fallback", e);
    const [font, fontBold] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
    ]);
    return { font, fontBold, fallback: true };
  }
}

// ---------- Image loading (cover) ----------
async function loadImage(
  url: string,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
): Promise<{ bytes: ArrayBuffer; type: "png" | "jpg" } | null> {
  try {
    let resolved = url;
    if (url.includes("/project-images/") && !url.includes("token=")) {
      const signed = await withTimeout(getSignedImageUrl(url, 3600), SIGNED_URL_TIMEOUT_MS, "signed URL");
      if (signed) resolved = signed;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    const res = await fetch(resolved, { cache: "force-cache", signal: controller.signal }).finally(() => {
      clearTimeout(timer);
    });
    if (!res.ok) {
      onWarning?.("image-skipped", res.status);
      return null;
    }
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 4));
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    return { bytes: buf, type: isPng ? "png" : "jpg" };
  } catch (e) {
    console.warn("[pdf-export] cover image load failed", e);
    onWarning?.("image-skipped", e);
    return null;
  }
}

// ---------- Helpers ----------
function safeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  try {
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function fmtDateYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function fmtDateCompact(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Filename date is the trip's first day, NOT today.
 * Accepts a Date (read in UTC to avoid TZ drift) or a 'YYYY-MM-DD' string.
 * Falls back to today if neither is usable.
 */
export function buildPdfFilename(projectName: string, tripStart: Date | string | undefined | null): string {
  const cleaned = (projectName || "trip")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 40) || "trip";
  let compact = "";
  if (typeof tripStart === "string") {
    // 'YYYY-MM-DD' → 'YYYYMMDD' (no timezone conversion)
    const m = tripStart.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) compact = `${m[1]}${m[2]}${m[3]}`;
  } else if (tripStart instanceof Date && !isNaN(tripStart.getTime())) {
    compact = fmtDateCompact(tripStart);
  }
  if (!compact) compact = fmtDateCompact(new Date());
  return `${cleaned}_${compact}.pdf`;
}

function perPerson(item: ItineraryItem): number {
  if (!item.price || item.price <= 0) return 0;
  const p = item.persons || 1;
  return Math.round(item.price / p);
}

/** Try-safe drawText. Substitutes missing glyphs with "·". */
function safeDrawText(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color?: ReturnType<typeof rgb> },
) {
  if (!text) return;
  try {
    page.drawText(text, opts);
    return;
  } catch {
    /* fall through */
  }
  const safe = Array.from(text)
    .map((ch) => {
      try {
        opts.font.widthOfTextAtSize(ch, opts.size);
        return ch;
      } catch {
        return "·";
      }
    })
    .join("");
  if (!safe) return;
  try {
    page.drawText(safe, opts);
  } catch {
    /* give up */
  }
}

const pdfIconCache = new Map<string, ArrayBuffer>();
let pdfCanvasFontsReady: Promise<void> | null = null;

function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window !== "undefined" && url.startsWith("/")) return `${window.location.origin}${url}`;
  return url;
}

async function ensurePdfCanvasFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  if (!pdfCanvasFontsReady) {
    pdfCanvasFontsReady = (async () => {
      const fonts = document.fonts;
      const regular = new FontFace("PeiTravelPdfNoto", `url(${resolveAssetUrl(LOCAL_FONT_REGULAR_URL)})`, { weight: "400" });
      const bold = new FontFace("PeiTravelPdfNoto", `url(${resolveAssetUrl(LOCAL_FONT_BOLD_URL)})`, { weight: "700" });
      const loaded = await Promise.all([regular.load(), bold.load()]);
      loaded.forEach((fontFace) => fonts.add(fontFace));
      await fonts.ready;
    })().catch((e) => {
      console.warn("[pdf-export] PDF canvas font load failed; using system fallback", e);
    });
  }
  await pdfCanvasFontsReady;
}

async function embedPdfIcon(doc: PDFDocument, fileName: string): Promise<PDFImage | null> {
  let bytes = pdfIconCache.get(fileName);
  if (!bytes) {
    const res = await fetch(`${import.meta.env.BASE_URL}${fileName}`, { cache: "force-cache" });
    if (!res.ok) return null;
    bytes = await res.arrayBuffer();
    pdfIconCache.set(fileName, bytes);
  }
  try {
    return await withTimeout(doc.embedPng(bytes), IMAGE_EMBED_TIMEOUT_MS, `PDF icon ${fileName} embed`);
  } catch (e) {
    console.warn("[pdf-export] PDF icon embed failed", { fileName, error: e });
    return null;
  }
}

async function drawPdfIcon(doc: PDFDocument, page: PDFPage, fileName: string, fallback: string, x: number, y: number, size: number) {
  const img = await embedPdfIcon(doc, fileName);
  if (img) {
    page.drawImage(img, { x, y, width: size, height: size });
    return;
  }
  safeDrawText(page, fallback, { x, y: y + 1, size, font: await doc.embedFont(StandardFonts.Helvetica), color: TEXT });
}

function pdfColorToCss(color?: ReturnType<typeof rgb>): string {
  const c = (color ?? TEXT) as unknown as { red?: number; green?: number; blue?: number };
  const toHex = (v = 0) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
  return `#${toHex(c.red)}${toHex(c.green)}${toHex(c.blue)}`;
}

function browserMeasureText(text: string, size: number, bold = false): number | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = `${bold ? 700 : 400} ${size}px "PeiTravelPdfNoto", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`;
  return ctx.measureText(text).width;
}

async function measurePdfText(text: string, font: PDFFont, size: number, bold = false): Promise<number> {
  await ensurePdfCanvasFonts();
  const measured = browserMeasureText(text, size, bold);
  if (measured !== null) return measured;
  try { return font.widthOfTextAtSize(text, size); } catch { return Array.from(text).length * size * 0.62; }
}

async function drawPdfText(
  doc: PDFDocument,
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color?: ReturnType<typeof rgb>; bold?: boolean; forceImage?: boolean },
): Promise<number> {
  if (!text) return 0;
  await ensurePdfCanvasFonts();
  const needsImage = opts.forceImage || /[^\x20-\x7e]/.test(text);
  if (typeof document !== "undefined" && needsImage) {
    const scale = 3;
    const measured = browserMeasureText(text, opts.size, opts.bold) ?? Array.from(text).length * opts.size * 0.62;
    const widthPt = Math.ceil(measured + 6);
    const heightPt = Math.ceil(opts.size * 1.45);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(widthPt * scale));
    canvas.height = Math.max(1, Math.ceil(heightPt * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.clearRect(0, 0, widthPt, heightPt);
      ctx.font = `${opts.bold ? 700 : 400} ${opts.size}px "PeiTravelPdfNoto", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`;
      ctx.fillStyle = pdfColorToCss(opts.color);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(text, 2, opts.size + 1);
      try {
        const img = await withTimeout(doc.embedPng(canvas.toDataURL("image/png")), IMAGE_EMBED_TIMEOUT_MS, "text image embed");
        page.drawImage(img, { x: opts.x, y: opts.y - (heightPt - opts.size), width: widthPt, height: heightPt });
        return widthPt;
      } catch (e) {
        console.warn("[pdf-export] text image embed failed; falling back to font text", { text, error: e });
      }
    }
  }
  safeDrawText(page, text, { x: opts.x, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
  return measurePdfText(text, opts.font, opts.size, opts.bold);
}

function wrapByWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of (text ?? "").split("\n")) {
    if (!para) {
      lines.push("");
      continue;
    }
    let cur = "";
    let curW = 0;
    for (const ch of Array.from(para)) {
      let w = size * 0.6;
      try {
        w = font.widthOfTextAtSize(ch, size);
      } catch {
        w = /[\x20-\x7e]/.test(ch) ? size * 0.55 : size;
      }
      if (curW + w > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
        curW = w;
      } else {
        cur += ch;
        curW += w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

// ---------- Link annotation ----------
function addLinkAnnotation(
  page: PDFPage,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const doc = page.doc;
  const linkDict = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "URI",
      URI: PDFString.of(url),
    },
  });
  const linkRef = doc.context.register(linkDict);
  const existing = page.node.lookup(PDFName.of("Annots"), PDFArray);
  if (existing) {
    existing.push(linkRef);
  } else {
    const arr = doc.context.obj([linkRef]) as PDFArray;
    page.node.set(PDFName.of("Annots"), arr);
  }
}

// ---------- Main export ----------
export interface ExportOptions {
  now?: Date;
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void;
  /**
   * DOM root rendered by PdfCaptureRoot. The exporter captures one node at a
   * time, embeds it into the PDF immediately, and releases the canvas before
   * moving on. Only ONE large canvas exists in memory at any moment.
   *
   * When null/undefined, the exporter falls back to the lightweight text PDF.
   */
  captureRoot?: HTMLElement | null;
}

// ---------- Sequential capture (one canvas in memory at a time) ----------
interface CaptureResult { dataUrl: string; w: number; h: number }
type Html2Canvas = typeof import("html2canvas-pro").default;

let html2canvasPromise: Promise<Html2Canvas> | null = null;
async function loadHtml2Canvas(): Promise<Html2Canvas> {
  if (!html2canvasPromise) {
    html2canvasPromise = withTimeout(
      import("html2canvas-pro").then((m) => m.default),
      8000,
      "html2canvas-pro import",
    );
  }
  return html2canvasPromise;
}

function captureProfile(): { scale: number; jpegQuality: number; isMobile: boolean } {
  const isMobile =
    typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return { isMobile, scale: isMobile ? 0.6 : 2, jpegQuality: isMobile ? 0.5 : 0.85 };
}

async function captureSingleNode(
  html2canvas: Html2Canvas,
  node: HTMLElement,
  scale: number,
  jpegQuality: number,
  label: string,
): Promise<CaptureResult | null> {
  const rect = node.getBoundingClientRect();
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = await withTimeout(
      html2canvas(node, {
        backgroundColor: "#ffffff",
        scale,
        useCORS: true,
        allowTaint: false,
        logging: false,
        imageTimeout: 6000,
        windowWidth: PDF_CAPTURE_WIDTH,
        width: Math.ceil(node.scrollWidth || rect.width || PDF_CAPTURE_WIDTH),
        height: Math.ceil(node.scrollHeight || rect.height || 1),
        scrollX: 0,
        scrollY: 0,
      }),
      HTML2CANVAS_TIMEOUT_MS,
      label,
    );
    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    const w = canvas.width;
    const h = canvas.height;
    return { dataUrl, w, h };
  } catch (e) {
    console.warn("[pdf-export] capture failed", label, e);
    return null;
  } finally {
    // Release canvas memory immediately
    if (canvas) {
      try { canvas.width = 0; canvas.height = 0; } catch { /* ignore */ }
    }
  }
}

function collectCardBounds(node: HTMLElement): CapturedCardBounds[] {
  const nodeRect = node.getBoundingClientRect();
  return Array.from(node.querySelectorAll<HTMLElement>("[data-pdf-card]")).map((card) => {
    const r = card.getBoundingClientRect();
    return {
      topPct: (r.top - nodeRect.top) / nodeRect.height,
      bottomPct: (r.bottom - nodeRect.top) / nodeRect.height,
    };
  });
}

/** Yield to the event loop so memory can be reclaimed between heavy ops. */
function yieldToLoop(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export async function exportProjectToPdf(
  project: TravelProject,
  opts: ExportOptions,
): Promise<Uint8Array> {
  console.info("[pdf-export] PDF snapshot export start", {
    projectId: project.id,
    projectName: project.name,
    hasCaptureRoot: !!opts.captureRoot,
  });
  if (opts.captureRoot) {
    try {
      return await buildPdfBytes(project, opts);
    } catch (e) {
      console.warn(
        "[pdf-export] PDF snapshot export failed, switching to lightweight text PDF",
        e,
      );
      opts.onWarning?.("day-snapshot-skipped", e);
    }
  } else {
    console.warn(
      "[pdf-export] PDF snapshot export failed, switching to lightweight text PDF",
      "no capture root",
    );
  }
  try {
    return await buildLightweightPdfBytes(project, opts);
  } catch (e) {
    console.error("[pdf-export] create pdf fail", { error: e });
    throw e;
  }
}

// ---------- Lightweight text-only fallback ----------
// Designed for maximum reliability: no images, no canvas-PNG text, no link
// annotations. Even very large itineraries (20 days) export successfully.
async function buildLightweightPdfBytes(
  project: TravelProject,
  opts: ExportOptions,
): Promise<Uint8Array> {
  console.info("[pdf-export] PDF lightweight export start", {
    projectId: project.id,
    days: project.itinerary?.length ?? 0,
  });
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { font, fontBold } = await embedPdfFonts(doc, opts.onWarning);

  const lineH = 14;
  const headerH = 22;
  const itemGap = 6;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const drawLine = (
    text: string,
    size: number,
    f: PDFFont,
    color: ReturnType<typeof rgb>,
    indent = 0,
  ) => {
    if (!text) return;
    const maxW = CONTENT_W - indent;
    const lines = wrapByWidth(text, f, size, maxW);
    for (const line of lines) {
      ensureSpace(size + 4);
      safeDrawText(page, line, { x: MARGIN + indent, y: y - size, size, font: f, color });
      y -= size + 4;
    }
  };

  // Trip header
  drawLine(project.name || "Trip", 20, fontBold, PRIMARY);
  y -= 4;
  const sd = safeDate(project.startDate);
  const ed = safeDate(project.endDate);
  let totalDays = Array.isArray(project.itinerary) ? project.itinerary.length : 0;
  if (sd && ed) {
    totalDays = Math.round((ed.getTime() - sd.getTime()) / 86400000) + 1;
    drawLine(`${fmtDateYMD(sd)}  -  ${fmtDateYMD(ed)}`, 12, font, MUTED);
  }
  drawLine(`Total Days: ${totalDays}`, 12, font, MUTED);
  y -= 10;

  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  for (const day of itinerary) {
    ensureSpace(headerH + lineH);
    y -= 4;
    drawLine(`Day ${day.dayNumber}`, 16, fontBold, PRIMARY);
    const items = Array.isArray(day.items) ? day.items : [];
    if (items.length === 0) {
      drawLine("(no items)", 11, font, MUTED, 12);
      continue;
    }
    const sorted = [...items].sort((a, b) =>
      (a.startTime || "").localeCompare(b.startTime || ""),
    );
    for (const item of sorted) {
      const source = item as ItineraryItem & {
        title?: unknown;
        name?: unknown;
        map_url?: unknown;
        location_url?: unknown;
        notes?: unknown;
        description?: unknown;
      };
      const time = item.startTime ? `${item.startTime}  ` : "";
      const title =
        String(source.title || source.name || source.description || "").trim() ||
        "(untitled)";
      drawLine(`- ${time}${title}`, 12, fontBold, TEXT, 8);
      const notes = String(source.notes || "").trim();
      if (notes) drawLine(`Notes: ${notes}`, 11, font, TEXT, 20);
      if (item.price && item.price > 0) {
        drawLine(`Cost: $${item.price.toLocaleString()}`, 11, font, MUTED, 20);
      }
      const rawUrl = item.googleMapsUrl || String(source.map_url || source.location_url || "");
      const mapUrl = sanitizeMapUrl(rawUrl) || rawUrl;
      if (mapUrl) drawLine(`Map: ${mapUrl}`, 10, font, MUTED, 20);
      y -= itemGap;
    }
  }

  console.info("[pdf-export] PDF save start", { mode: "lightweight" });
  const bytes = await withTimeout(doc.save(), PDF_SAVE_TIMEOUT_MS, "PDF save");
  console.info("[pdf-export] PDF save done", { mode: "lightweight", bytes: bytes.length });
  return bytes;
}


async function buildPdfBytes(project: TravelProject, opts: ExportOptions): Promise<Uint8Array> {
  console.info("pdf create start");
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { font, fontBold } = await embedPdfFonts(doc, opts.onWarning);

  const allSnapshots = opts.capturedDays ?? [];
  const coverSnapshot = allSnapshots.find((d) => d.dayNumber === 0) ?? null;
  const days = allSnapshots.filter((d) => d.dayNumber > 0);

  // ===== Cover =====
  if (coverSnapshot && coverSnapshot.dataUrl && coverSnapshot.widthPx && coverSnapshot.heightPx) {
    try {
      await drawCoverSnapshotPage(doc, coverSnapshot, opts.onWarning);
    } catch (e) {
      console.warn("[pdf-export] cover snapshot failed; falling back to programmatic cover", e);
      await drawCover(doc, font, fontBold, project, opts.now ?? new Date(), opts.onWarning);
    }
  } else {
    await drawCover(doc, font, fontBold, project, opts.now ?? new Date(), opts.onWarning);
  }

  // ===== One page per Day (snapshot + fixed map-links section) =====
  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  for (const cap of days) {
    const dayData = itinerary.find((d) => d.dayNumber === cap.dayNumber);
    try {
      if (!cap.dataUrl || !cap.widthPx || !cap.heightPx) {
        throw new Error("missing snapshot");
      }
      await drawDaySnapshotPage(doc, cap, font, fontBold, dayData, opts.onWarning);
    } catch (e) {
      console.warn("[pdf-export] day render failed; inserting fallback page", { day: cap.dayNumber, error: e });
      opts.onWarning?.("day-snapshot-skipped", { day: cap.dayNumber, error: e });
      await drawDayFallbackPage(doc, font, fontBold, cap.dayNumber, dayData);
    }
  }

  // ===== Closing page =====
  await drawEndPage(doc, font, fontBold);

  console.info("[pdf-export] PDF save start", { mode: "snapshot" });
  const bytes = await withTimeout(doc.save(), PDF_SAVE_TIMEOUT_MS, "PDF save");
  console.info("[pdf-export] PDF save done", { mode: "snapshot", bytes: bytes.length, pages: doc.getPageCount() });
  return bytes;
}

/** Internal smoke-test hook for generating a deterministic PDF preview in Vitest/QA. */
export async function __debugBuildPdfBytes(project: TravelProject, opts: ExportOptions): Promise<Uint8Array> {
  return buildPdfBytes(project, opts);
}

// ---------- Cover from snapshot ----------
async function drawCoverSnapshotPage(
  doc: PDFDocument,
  cap: { dataUrl: string; widthPx: number; heightPx: number },
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
) {
  const base64 = cap.dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const isPng = cap.dataUrl.startsWith("data:image/png");
  const img = await withTimeout(
    isPng ? doc.embedPng(bytes) : doc.embedJpg(bytes),
    IMAGE_EMBED_TIMEOUT_MS,
    "cover snapshot embed",
  );
  const page = doc.addPage([PAGE_W, PAGE_H]);
  // Top accent
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: PRIMARY });
  // Fit cover image into content area, centred, preserving aspect
  const ratio = img.width / img.height;
  let drawW = CONTENT_W;
  let drawH = drawW / ratio;
  const maxH = PAGE_H - MARGIN * 2 - 18;
  if (drawH > maxH) {
    drawH = maxH;
    drawW = drawH * ratio;
  }
  const x = (PAGE_W - drawW) / 2;
  const yBottom = (PAGE_H - drawH) / 2;
  page.drawImage(img, { x, y: yBottom, width: drawW, height: drawH });
  void onWarning;
}

// ---------- App logo (end page) ----------
let endLogoBytes: ArrayBuffer | null = null;
async function loadEndLogo(): Promise<ArrayBuffer | null> {
  if (endLogoBytes) return endLogoBytes;
  try {
    const url = `${import.meta.env.BASE_URL}pdf-app-logo.png`;
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    endLogoBytes = await res.arrayBuffer();
    return endLogoBytes;
  } catch (e) {
    console.warn("[pdf-export] end logo load failed", e);
    return null;
  }
}

// ---------- Closing page ----------
async function drawEndPage(doc: PDFDocument, font: PDFFont, fontBold: PDFFont) {
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const line1 = "🎉  旅途順利";
  const line2 = "此行程由 PeiTravel App 匯出完成";
  const wordmark = "PeiTravel";
  const size1 = 18;
  const size2 = 14;
  const sizeWord = 12;
  const logoSize = 44;
  const gap1 = 18;  // line1 -> line2
  const gap2 = 60;  // line2 -> logo
  const gap3 = 12;  // logo -> wordmark

  const totalH = size1 + gap1 + size2 + gap2 + logoSize + gap3 + sizeWord;
  let y = PAGE_H / 2 + totalH / 2;

  const drawCentred = async (text: string, size: number, f: PDFFont, color: ReturnType<typeof rgb>, bold = false) => {
    const w = await measurePdfText(text, f, size, bold);
    await drawPdfText(doc, page, text, { x: (PAGE_W - w) / 2, y: y - size, size, font: f, color, bold, forceImage: true });
    y -= size;
  };

  await drawCentred(line1, size1, fontBold, rgb(0.27, 0.30, 0.38), true);
  y -= gap1;
  await drawCentred(line2, size2, font, rgb(0.55, 0.60, 0.68));
  y -= gap2;

  // Logo (small)
  const logoBytes = await loadEndLogo();
  if (logoBytes) {
    try {
      const img = await withTimeout(doc.embedPng(logoBytes), IMAGE_EMBED_TIMEOUT_MS, "end logo embed");
      page.drawImage(img, {
        x: (PAGE_W - logoSize) / 2,
        y: y - logoSize,
        width: logoSize,
        height: logoSize,
      });
    } catch (e) {
      console.warn("[pdf-export] end logo embed failed", e);
    }
  }
  y -= logoSize + gap3;
  await drawCentred(wordmark, sizeWord, fontBold, rgb(0.60, 0.65, 0.72), true);
}

// ---------- Map links section ----------
interface DayMapLink {
  title: string;        // may contain '\n' — preserve user formatting
  url: string;
  label: string;        // provider, used only for button text
}

function getMapButtonText(provider: string): string {
  return provider === "高德地圖" ? "開啟高德地圖 ↗" : `開啟 ${provider} ↗`;
}

function collectDayMapLinks(day: DayItinerary | undefined): DayMapLink[] {
  if (!day || !Array.isArray(day.items)) return [];
  const links: DayMapLink[] = [];
  for (const item of day.items) {
    const source = item as ItineraryItem & { title?: unknown; name?: unknown; map_url?: unknown; location_url?: unknown };
    const rawUrl = item.googleMapsUrl || String(source.map_url || source.location_url || "");
    const url = sanitizeMapUrl(rawUrl);
    if (!url) continue;
    // Preserve user's full title verbatim, including line breaks (CJK / KR / JP).
    const rawTitle = String(source.title || source.name || item.description || "").replace(/\s+$/g, "");
    const title = rawTitle || "景點連結";
    links.push({ title, url, label: getMapProviderLabel(url) });
  }
  return links;
}

async function drawMapLinksSection(
  doc: PDFDocument,
  font: PDFFont,
  fontBold: PDFFont,
  dayNumber: number,
  links: DayMapLink[],
) {
  if (links.length === 0) return;

  // Layout constants
  const cardPad = 16;
  const titleSize = 13;
  const titleLineH = 18;
  const titleToButton = 12;
  const buttonSize = 11;
  const buttonH = 30;
  const cardGap = 12;
  const headerH = 52;
  const pinSize = titleSize + 1;
  const pinGap = 6;

  const startNewPage = async (continuation: boolean): Promise<{ page: PDFPage; y: number }> => {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    p.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: PRIMARY });
    await drawPdfText(doc, p, `Day ${dayNumber}｜導航連結${continuation ? "（續）" : ""}`, {
      x: MARGIN, y: PAGE_H - MARGIN - 14, size: 17, font: fontBold, color: PRIMARY, bold: true, forceImage: true,
    });
    await drawPdfText(doc, p, "點擊卡片即可開啟導航", {
      x: MARGIN, y: PAGE_H - MARGIN - 34, size: 11, font, color: MUTED, forceImage: true,
    });
    return { page: p, y: PAGE_H - MARGIN - headerH };
  };

  let { page, y } = await startNewPage(false);

  for (const link of links) {
    const titleLines = link.title.split("\n");
    const titleBlockH = titleLines.length * titleLineH;
    const cardH = cardPad + titleBlockH + titleToButton + buttonH + cardPad;

    if (y - cardH < MARGIN + 20) {
      const next = await startNewPage(true);
      page = next.page;
      y = next.y;
    }
    const cardTop = y;
    const cardBottom = y - cardH;

    // Card background
    page.drawRectangle({
      x: MARGIN, y: cardBottom, width: CONTENT_W, height: cardH,
      color: rgb(0.97, 0.98, 1),
      borderColor: rgb(0.84, 0.9, 0.97),
      borderWidth: 0.8,
    });

    // 📍 pin (rendered via canvas-PNG so it appears on every platform)
    const pinY = cardTop - cardPad - titleSize + 1;
    await drawPdfText(doc, page, "📍", {
      x: MARGIN + cardPad,
      y: pinY,
      size: pinSize,
      font: fontBold,
      color: TEXT,
      bold: true,
      forceImage: true,
    });

    // Title — preserve user line breaks verbatim
    const titleX = MARGIN + cardPad + pinSize + pinGap;
    let lineY = cardTop - cardPad - titleSize + 2;
    for (const line of titleLines) {
      await drawPdfText(doc, page, line, {
        x: titleX,
        y: lineY,
        size: titleSize,
        font: fontBold,
        color: TEXT,
        bold: true,
        forceImage: true,
      });
      lineY -= titleLineH;
    }

    // CTA button (single line, provider in button text only)
    const buttonText = getMapButtonText(link.label);
    const textW = await measurePdfText(buttonText, fontBold, buttonSize, true);
    const btnW = Math.min(CONTENT_W - cardPad * 2, textW + 36);
    const btnX = MARGIN + cardPad;
    const btnY = cardBottom + cardPad;
    page.drawRectangle({ x: btnX, y: btnY, width: btnW, height: buttonH, color: PRIMARY });
    await drawPdfText(doc, page, buttonText, {
      x: btnX + (btnW - textW) / 2,
      y: btnY + (buttonH - buttonSize) / 2 + 2,
      size: buttonSize,
      font: fontBold,
      color: rgb(1, 1, 1),
      bold: true,
      forceImage: true,
    });
    addLinkAnnotation(page, link.url, btnX, btnY, btnW, buttonH);
    // Whole card is clickable
    addLinkAnnotation(page, link.url, MARGIN, cardBottom, CONTENT_W, cardH);

    y = cardBottom - cardGap;
  }
}

// ---------- Day fallback (snapshot failed) ----------
async function drawDayFallbackPage(
  doc: PDFDocument,
  font: PDFFont,
  fontBold: PDFFont,
  dayNumber: number,
  day: DayItinerary | undefined,
) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  safeDrawText(page, `Day ${dayNumber}`, {
    x: MARGIN, y: PAGE_H - MARGIN - 24, size: 22, font: fontBold, color: PRIMARY,
  });
  safeDrawText(page, "此天畫面匯出失敗，請回 App 查看完整內容。", {
    x: MARGIN, y: PAGE_H - MARGIN - 56, size: 12, font, color: MUTED,
  });
  // Still show map links so user gets value
  const links = collectDayMapLinks(day);
  if (links.length > 0) {
      await drawMapLinksSection(doc, font, fontBold, dayNumber, links);
  }
}

// ---------- Cover ----------
async function drawCover(
  doc: PDFDocument,
  font: PDFFont,
  fontBold: PDFFont,
  project: TravelProject,
  now: Date,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
) {
  const page = doc.addPage([PAGE_W, PAGE_H]);

  // Top accent bar
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: PRIMARY });

  let y = PAGE_H - 56;

  safeDrawText(page, "PeiTravel", {
    x: MARGIN, y, size: 13, font: fontBold, color: PRIMARY,
  });
  y -= 28;

  // Title
  const titleLines = wrapByWidth(project.name || "未命名行程", fontBold, 26, CONTENT_W);
  for (const line of titleLines.slice(0, 3)) {
    safeDrawText(page, line, { x: MARGIN, y, size: 26, font: fontBold, color: TEXT });
    y -= 34;
  }
  y -= 4;

  // Date range
  const sd = safeDate(project.startDate);
  const ed = safeDate(project.endDate);
  let days = 0;
  if (sd && ed) {
    days = Math.round((ed.getTime() - sd.getTime()) / 86400000) + 1;
    safeDrawText(page, `${fmtDateYMD(sd)}  ─  ${fmtDateYMD(ed)}`, {
      x: MARGIN, y, size: 13, font, color: MUTED,
    });
    y -= 22;
  }

  // Cover image
  if (project.coverImageUrl) {
    const img = await loadImage(project.coverImageUrl, onWarning);
    if (img) {
      try {
        const embedded = await withTimeout(
          img.type === "png" ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes),
          IMAGE_EMBED_TIMEOUT_MS,
          "cover embed",
        );
        const maxH = 280;
        const maxW = CONTENT_W;
        const ratio = embedded.width / embedded.height;
        let w = maxW;
        let h = w / ratio;
        if (h > maxH) {
          h = maxH;
          w = h * ratio;
        }
        const x = MARGIN + (CONTENT_W - w) / 2;
        page.drawImage(embedded, { x, y: y - h, width: w, height: h });
        y -= h + 22;
      } catch (e) {
        console.warn("[pdf-export] cover embed failed", e);
        onWarning?.("image-skipped", e);
      }
    }
  }

  // Stats
  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  const allItems = itinerary.flatMap((d) => (Array.isArray(d?.items) ? d.items : []));
  const totalPerPerson = allItems.reduce((s, i) => s + perPerson(i), 0);
  const totalRaw = allItems.reduce((s, i) => s + (i.price ?? 0), 0);
  // maxPersons intentionally not shown on cover

  const stats: Array<[string, string]> = [
    ["總天數", `${days} 天`],
    ["行程數", `${allItems.length} 項`],
    ["總花費", `$${totalRaw.toLocaleString()}`],
    ["單人總花費", `$${totalPerPerson.toLocaleString()}`],
    ["匯出日期", fmtDateYMD(now)],
  ];
  const lineH = 20;
  const boxH = stats.length * lineH + 18;
  // Keep stats above bottom margin
  if (y - boxH < MARGIN + 24) y = MARGIN + 24 + boxH;
  page.drawRectangle({
    x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: PRIMARY_LIGHT,
  });
  let ty = y - 20;
  for (const [k, v] of stats) {
    safeDrawText(page, k, { x: MARGIN + 18, y: ty, size: 11.5, font, color: MUTED });
    safeDrawText(page, v, { x: MARGIN + 130, y: ty, size: 12, font: fontBold, color: TEXT });
    ty -= lineH;
  }

  safeDrawText(page, "由 PeiTravel 產生", {
    x: MARGIN, y: 18, size: 9, font, color: MUTED,
  });
}

// ---------- Day snapshot page ----------
async function drawDaySnapshotPage(
  doc: PDFDocument,
  cap: CapturedDay,
  font: PDFFont,
  fontBold: PDFFont,
  dayData: DayItinerary | undefined,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
) {
  // Parse data URL → bytes
  const base64 = cap.dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const isPng = cap.dataUrl.startsWith("data:image/png");

  let img;
  try {
    img = await withTimeout(
      isPng ? doc.embedPng(bytes) : doc.embedJpg(bytes),
      IMAGE_EMBED_TIMEOUT_MS,
      "day snapshot embed",
    );
  } catch (e) {
    console.warn("[pdf-export] day snapshot embed failed", { day: cap.dayNumber, error: e });
    onWarning?.("day-snapshot-skipped", e);
    throw e;
  }

  // Fit into content area preserving aspect.
  const imgRatio = img.width / img.height; // w/h
  let drawW = CONTENT_W;
  let drawH = drawW / imgRatio;
  if (drawH <= CONTENT_H) {
    // Fits on one page
    const x = MARGIN + (CONTENT_W - drawW) / 2;
    const yTop = PAGE_H - MARGIN;
    const yBottom = yTop - drawH;
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawImage(img, { x, y: yBottom, width: drawW, height: drawH });
  } else {
    // Image is taller than one page — split into vertical slices, one page each.
    // Prefer page breaks between itinerary cards when PdfCaptureRoot provides bounds.
    const sliceBreaks: Array<{ start: number; end: number }> = [];
    let start = 0;
    const minUsefulSlice = CONTENT_H * 0.35;
    const cardBounds = (cap.cardBounds ?? [])
      .map((b) => ({ top: b.topPct * drawH, bottom: b.bottomPct * drawH }))
      .filter((b) => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top)
      .sort((a, b) => a.top - b.top);

    while (start < drawH - 1) {
      let end = Math.min(start + CONTENT_H, drawH);
      if (end < drawH) {
        const crossing = cardBounds.find((b) => b.top < end && b.bottom > end);
        if (crossing && crossing.top - start >= minUsefulSlice) {
          end = crossing.top;
        }
      }
      if (end <= start + 8) end = Math.min(start + CONTENT_H, drawH);
      sliceBreaks.push({ start, end });
      start = end;
    }

    for (let s = 0; s < sliceBreaks.length; s++) {
      const slice = sliceBreaks[s];
      const page = doc.addPage([PAGE_W, PAGE_H]);
      const x = MARGIN + (CONTENT_W - drawW) / 2;
      const visibleH = slice.end - slice.start;
      const yTopOfSliceInImage = slice.start;
      const imageBottomY = (PAGE_H - MARGIN) + yTopOfSliceInImage - drawH;
      page.drawImage(img, { x, y: imageBottomY, width: drawW, height: drawH });
      // Mask outside the intended content slice.
      page.drawRectangle({ x: 0, y: PAGE_H - MARGIN, width: PAGE_W, height: MARGIN, color: rgb(1, 1, 1) });
      page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H - MARGIN - visibleH, color: rgb(1, 1, 1) });
      safeDrawText(page, `(${s + 1}/${sliceBreaks.length})`, {
        x: PAGE_W - MARGIN - 30,
        y: 14,
        size: 8,
        font,
        color: MUTED,
      });
    }
  }

  // Fixed map-links section (no DOM coordinate math, fully reliable)
  const links = collectDayMapLinks(dayData);
  if (links.length > 0) {
    await drawMapLinksSection(doc, font, fontBold, cap.dayNumber, links);
  }
}


// ---------- Save / share ----------
export async function deliverPdf(bytes: Uint8Array, filename: string): Promise<"shared" | "downloaded"> {
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" });
  const triggerDownload = () => {
    console.info("download start", { filename, bytes: bytes.length });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    console.info("download complete", { filename });
  };

  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const isNative = !!cap?.isNativePlatform?.();
  const isMobileBrowser = !isNative && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (!isNative) {
    if (isMobileBrowser) {
      try {
        const file = new File([blob], filename, { type: "application/pdf" });
        const nav = navigator as Navigator & {
          canShare?: (data: { files?: File[] }) => boolean;
          share?: (data: { files?: File[]; title?: string }) => Promise<void>;
        };
        if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
          console.info("share start", { mode: "web-share", filename, bytes: bytes.length });
          await withTimeout(nav.share({ files: [file], title: filename }), SHARE_TIMEOUT_MS, "navigator.share");
          console.info("share success", { mode: "web-share" });
          console.info("[pdf-export] share/download success", { mode: "web-share" });
          return "shared";
        }
      } catch (e) {
        console.warn("share failed", e);
        console.warn("[pdf-export] web share fallback", e);
      }
    }
    triggerDownload();
    console.info("[pdf-export] share/download success", { mode: "download" });
    return "downloaded";
  }

  try {
    console.info("share start", { mode: "native", filename, bytes: bytes.length });
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const writeResult = await withTimeout(
      Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      }),
      15000,
      "native PDF file write",
    );
    await withTimeout(
      Share.share({
        title: filename,
        files: [writeResult.uri],
        dialogTitle: filename,
      }),
      SHARE_TIMEOUT_MS,
      "native share",
    );
    console.info("share success", { mode: "native" });
    console.info("[pdf-export] share/download success", { mode: "native-share" });
    return "shared";
  } catch (e) {
    console.warn("share failed", e);
    console.warn("[pdf-export] share fallback", e);
  }
  triggerDownload();
  console.info("[pdf-export] share/download success", { mode: "download(fallback)" });
  return "downloaded";
}
