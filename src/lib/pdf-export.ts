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
import type { CapturedDay } from "@/components/PdfCaptureRoot";
import { sanitizeMapUrl, getMapProviderLabel } from "@/utils/mapLink";

// ---------- Fonts ----------
const FONT_REGULAR_URL =
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf";
const FONT_BOLD_URL =
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Bold.otf";
const LOCAL_FONT_REGULAR_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Regular.otf`;
const LOCAL_FONT_BOLD_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Bold.otf`;

const FONT_TIMEOUT_MS = 7000;
const FONT_EMBED_TIMEOUT_MS = 9000;
const SIGNED_URL_TIMEOUT_MS = 5000;
const IMAGE_FETCH_TIMEOUT_MS = 10000;
const IMAGE_EMBED_TIMEOUT_MS = 6000;
const PDF_SAVE_TIMEOUT_MS = 15000;
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
let fontSource: "cdn" | "local" = "cdn";

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

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer; source: "cdn" | "local" }> {
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
      console.warn("[pdf-export] jsDelivr font fetch failed; trying bundled fallback", e);
      [r, b] = await Promise.all([
        fontRegularBytes ?? fetchBuffer(LOCAL_FONT_REGULAR_URL),
        fontBoldBytes ?? fetchBuffer(LOCAL_FONT_BOLD_URL),
      ]);
      fontSource = "local";
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
): Promise<{ font: PDFFont; fontBold: PDFFont }> {
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
    return { font, fontBold };
  } catch (e) {
    console.warn("[pdf-export] load font fail; using Helvetica fallback", e);
    onWarning?.("font-fallback", e);
    const [font, fontBold] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
    ]);
    return { font, fontBold };
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
  ctx.font = `${bold ? 700 : 400} ${size}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`;
  return ctx.measureText(text).width;
}

async function measurePdfText(text: string, font: PDFFont, size: number, bold = false): Promise<number> {
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
      ctx.font = `${opts.bold ? 700 : 400} ${opts.size}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`;
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
  /** Captured day snapshots from PdfCaptureRoot. */
  capturedDays: CapturedDay[];
}

export async function exportProjectToPdf(
  project: TravelProject,
  opts: ExportOptions,
): Promise<Uint8Array> {
  console.info("[pdf-export] start export", {
    projectId: project.id,
    projectName: project.name,
    capturedDays: opts.capturedDays?.length ?? 0,
  });
  try {
    return await buildPdfBytes(project, opts);
  } catch (e) {
    console.info("[pdf-export] create pdf fail", { error: e });
    throw e;
  }
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

  console.info("pdf save start");
  const bytes = await withTimeout(doc.save(), PDF_SAVE_TIMEOUT_MS, "PDF save");
  console.info("pdf save complete", { bytes: bytes.length });
  console.info("[pdf-export] create pdf success", { bytes: bytes.length, pages: doc.getPageCount() });
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

  const line1 = "旅途順利，玩得開心";
  const line2 = "此行程由 PeiTravel App 匯出完成";
  const wordmark = "PeiTravel";
  const size1 = 20;
  const size2 = 14;
  const sizeWord = 12;
  const logoSize = 60;
  const gap1 = 22; // line1 -> line2
  const gap2 = 44; // line2 -> logo
  const gap3 = 14; // logo -> wordmark

  // Stack: line1 / line2 / (gap) / logo / wordmark — centred vertically
  const totalH = size1 + gap1 + size2 + gap2 + logoSize + gap3 + sizeWord;
  let y = PAGE_H / 2 + totalH / 2;

  const drawCentred = async (text: string, size: number, f: PDFFont, color: ReturnType<typeof rgb>, bold = false) => {
    const w = await measurePdfText(text, f, size, bold);
    await drawPdfText(doc, page, text, { x: (PAGE_W - w) / 2, y: y - size, size, font: f, color, bold });
    y -= size;
  };

  const line1W = await measurePdfText(line1, fontBold, size1, true);
  const emojiGap = 8;
  const line1TotalW = logoSize / 3 + emojiGap + line1W;
  const line1X = (PAGE_W - line1TotalW) / 2;
  await drawPdfIcon(doc, page, "pdf-party.png", "*", line1X, y - size1 - 1, logoSize / 3);
  await drawPdfText(doc, page, line1, {
    x: line1X + logoSize / 3 + emojiGap,
    y: y - size1,
    size: size1,
    font: fontBold,
    color: rgb(0.32, 0.36, 0.44),
    bold: true,
  });
  y -= size1;
  y -= gap1;
  await drawCentred(line2, size2, font, rgb(0.5, 0.55, 0.62));
  y -= gap2;

  // Logo
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
  await drawCentred(wordmark, sizeWord, fontBold, rgb(0.55, 0.6, 0.68), true);
}

// ---------- Map links section ----------
interface DayMapLink {
  title: string;
  url: string;
  label: string;
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
    const rawTitle = String(source.title || source.name || item.description || "")
      .split("\n")[0]
      .trim();
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
  // Card layout — title + provider label + clear CTA button
  const cardPad = 14;
  const titleSize = 13;
  const providerSize = 10.5;
  const buttonSize = 11;
  const buttonH = 28;
  // height = pad + title + 6 + provider + 12 + button + pad
  const cardH = cardPad + titleSize + 6 + providerSize + 12 + buttonH + cardPad;
  const cardGap = 12;
  const headerH = 52;
  const startNewPage = (continuation: boolean): { page: PDFPage; y: number } => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: PRIMARY });
    safeDrawText(page, `Day ${dayNumber}｜導航連結${continuation ? "（續）" : ""}`, {
      x: MARGIN, y: PAGE_H - MARGIN - 14, size: 17, font: fontBold, color: PRIMARY,
    });
    safeDrawText(page, "以下連結可直接開啟導航", {
      x: MARGIN, y: PAGE_H - MARGIN - 34, size: 11, font, color: MUTED,
    });
    return { page, y: PAGE_H - MARGIN - headerH };
  };
  let { page, y } = startNewPage(false);

  for (const link of links) {
    if (y - cardH < MARGIN + 20) {
      const next = startNewPage(true);
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
    // Title — pin icon + first line of item title, single line (truncated)
    const titleText = link.title;
    const titleLines = wrapByWidth(titleText, fontBold, titleSize, CONTENT_W - cardPad * 2);
    await drawPdfIcon(doc, page, "pdf-pin.png", "•", MARGIN + cardPad, cardTop - cardPad - titleSize + 1, titleSize);
    safeDrawText(page, titleLines[0] ?? titleText, {
      x: MARGIN + cardPad + titleSize + 6,
      y: cardTop - cardPad - titleSize + 2,
      size: titleSize,
      font: fontBold,
      color: TEXT,
    });
    // Provider label (small, muted)
    safeDrawText(page, link.label, {
      x: MARGIN + cardPad,
      y: cardTop - cardPad - titleSize - 6 - providerSize + 2,
      size: providerSize,
      font,
      color: MUTED,
    });
    // CTA button
    const buttonText = getMapButtonText(link.label);
    let textW = 120;
    try { textW = fontBold.widthOfTextAtSize(buttonText, buttonSize); } catch { /* keep */ }
    const btnW = Math.min(CONTENT_W - cardPad * 2, textW + 32);
    const btnX = MARGIN + cardPad;
    const btnY = cardBottom + cardPad;
    page.drawRectangle({
      x: btnX, y: btnY, width: btnW, height: buttonH,
      color: PRIMARY,
    });
    safeDrawText(page, buttonText, {
      x: btnX + (btnW - textW) / 2,
      y: btnY + (buttonH - buttonSize) / 2 + 2,
      size: buttonSize,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    addLinkAnnotation(page, link.url, btnX, btnY, btnW, buttonH);
    // Whole card also clickable
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
