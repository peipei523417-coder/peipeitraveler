/**
 * PDF export for a TravelProject.
 *
 * Stability-first design:
 *   - Uses pdf-lib + fontkit (Noto Sans TC) for real TC support and real
 *     clickable link annotations (works on iOS Files, Android viewers, etc.).
 *   - Font files are fetched on-demand from a public CDN and cached in-memory
 *     for the session. They are ~6 MB total; the bundle stays light.
 *   - Image loading failures are isolated per-image. The PDF still succeeds.
 *   - All link URLs are sanitized before being written into PDF annotations.
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
import type { TravelProject, ItineraryItem, DayItinerary, TimelineIconType } from "@/types/travel";
import { sanitizeMapUrl, getMapProviderLabel } from "@/utils/mapLink";
import { getSignedImageUrl } from "@/lib/supabase-storage";

// ---------- Constants ----------
const FONT_REGULAR_URL =
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf";
const FONT_BOLD_URL =
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Bold.otf";
const LOCAL_FONT_REGULAR_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Regular.otf`;
const LOCAL_FONT_BOLD_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Bold.otf`;
// Monochrome emoji font (TTF) — used ONLY for emoji glyphs (icon, 💰, 📍).
// Optional: if it fails, we fall back to a colored badge + CJK label.
const FONT_EMOJI_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/fonts/NotoEmoji-Regular.ttf";
const FONT_TIMEOUT_MS = 7000;
const FONT_EMOJI_TIMEOUT_MS = 5000;
const FONT_EMBED_TIMEOUT_MS = 9000;
const SIGNED_URL_TIMEOUT_MS = 5000;
const IMAGE_FETCH_TIMEOUT_MS = 10000;
const IMAGE_EMBED_TIMEOUT_MS = 6000;
const PDF_SAVE_TIMEOUT_MS = 12000;
const SHARE_TIMEOUT_MS = 12000;

// A4
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const PRIMARY = rgb(0.008, 0.522, 0.78);
const PRIMARY_LIGHT = rgb(0.86, 0.94, 0.99);
const TEXT = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.46, 0.55);
const CARD_BORDER = rgb(0.85, 0.88, 0.92);
const WHITE = rgb(1, 1, 1);

const HIGHLIGHT_RGB: Record<string, ReturnType<typeof rgb>> = {
  yellow: rgb(1.0, 0.97, 0.78),
  green: rgb(0.85, 0.96, 0.86),
  blue: rgb(0.84, 0.93, 1.0),
  pink: rgb(1.0, 0.88, 0.94),
  purple: rgb(0.92, 0.87, 0.98),
  orange: rgb(1.0, 0.9, 0.78),
};

// Icon → emoji (preferred via Noto Emoji) and CJK fallback char when emoji
// font is unavailable. Fallback char renders inside a colored badge.
const ICON_EMOJI: Record<TimelineIconType, string> = {
  default: "📌",
  heart: "❤",
  utensils: "🍴",
  house: "🏠",
  star: "⭐",
  alert: "❗",
  question: "❓",
  car: "🚗",
};
const ICON_FALLBACK_CHAR: Record<TimelineIconType, string> = {
  default: "‧",
  heart: "心",
  utensils: "食",
  house: "宿",
  star: "★",
  alert: "！",
  question: "？",
  car: "車",
};
const ICON_COLOR: Record<TimelineIconType, ReturnType<typeof rgb>> = {
  default: rgb(0.008, 0.522, 0.78),
  heart:   rgb(0.91, 0.31, 0.43),
  utensils:rgb(0.95, 0.55, 0.18),
  house:   rgb(0.40, 0.45, 0.85),
  star:    rgb(0.92, 0.74, 0.13),
  alert:   rgb(0.93, 0.45, 0.13),
  question:rgb(0.20, 0.60, 0.85),
  car:     rgb(0.13, 0.66, 0.60),
};

const HIGHLIGHT_BAR: Record<string, ReturnType<typeof rgb>> = {
  yellow: rgb(0.96, 0.80, 0.18),
  green:  rgb(0.36, 0.78, 0.42),
  blue:   rgb(0.25, 0.61, 0.92),
  pink:   rgb(0.93, 0.43, 0.65),
  purple: rgb(0.62, 0.45, 0.88),
  orange: rgb(0.96, 0.60, 0.20),
};


// ---------- Font loading (cached in module) ----------
let fontRegularBytes: ArrayBuffer | null = null;
let fontBoldBytes: ArrayBuffer | null = null;
let fontEmojiBytes: ArrayBuffer | null = null;
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

async function loadEmojiFont(): Promise<ArrayBuffer | null> {
  if (fontEmojiBytes) return fontEmojiBytes;
  try {
    const bytes = await fetchBuffer(FONT_EMOJI_URL, FONT_EMOJI_TIMEOUT_MS);
    fontEmojiBytes = bytes;
    return bytes;
  } catch (e) {
    console.warn("[pdf-export] emoji font fetch failed (will use fallback badge)", e);
    return null;
  }
}

export type PdfExportWarning = "font-fallback" | "image-skipped";

async function embedPdfFonts(
  doc: PDFDocument,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
): Promise<{ font: PDFFont; fontBold: PDFFont; fontEmoji: PDFFont | null; usedFallback: boolean }> {
  try {
    console.info("[pdf-export] load font start");
    const { regular, bold, source } = await loadFonts();
    const [font, fontBold] = await withTimeout(
      Promise.all([
        doc.embedFont(regular, { subset: true }),
        doc.embedFont(bold, { subset: true }),
      ]),
      FONT_EMBED_TIMEOUT_MS,
      "font embed",
    );

    // Optional emoji font — never blocks export.
    let fontEmoji: PDFFont | null = null;
    try {
      const emojiBytes = await loadEmojiFont();
      if (emojiBytes) {
        fontEmoji = await withTimeout(
          doc.embedFont(emojiBytes, { subset: true }),
          FONT_EMBED_TIMEOUT_MS,
          "emoji font embed",
        );
        console.info("[pdf-export] load emoji font success");
      } else {
        console.info("[pdf-export] emoji font unavailable; using CJK fallback");
      }
    } catch (ee) {
      console.warn("[pdf-export] emoji font embed failed; using CJK fallback", ee);
    }

    if (source === "local") onWarning?.("font-fallback", "bundled Noto Sans TC");
    console.info("[pdf-export] load font success", {
      source: source === "cdn" ? "jsDelivr Noto Sans TC" : "bundled Noto Sans TC fallback",
      emoji: !!fontEmoji,
    });
    return { font, fontBold, fontEmoji, usedFallback: false };
  } catch (e) {
    console.warn("[pdf-export] load font fail; using fallback", e);
    onWarning?.("font-fallback", e);
    const [font, fontBold] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
    ]);
    return { font, fontBold, fontEmoji: null, usedFallback: true };
  }
}

// ---------- Image loading ----------
interface LoadedImage {
  bytes: ArrayBuffer;
  type: "png" | "jpg";
}

async function loadImage(
  url: string,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
): Promise<LoadedImage | null> {
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
      const error = new Error(`image fetch failed: ${res.status}`);
      console.info("[pdf-export] load images fail", { url, status: res.status });
      onWarning?.("image-skipped", error);
      return null;
    }
    const buf = await res.arrayBuffer();
    // Sniff
    const head = new Uint8Array(buf.slice(0, 4));
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    console.info("[pdf-export] load images success", { url, bytes: buf.byteLength });
    return { bytes: buf, type: isPng ? "png" : "jpg" };
  } catch (e) {
    console.warn("[pdf-export] image load failed", e);
    console.info("[pdf-export] load images fail", { url, error: e });
    onWarning?.("image-skipped", e);
    return null;
  }
}

async function embedLoadedImage(
  doc: PDFDocument,
  img: LoadedImage,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
): Promise<PDFImage | null> {
  try {
    return await withTimeout(
      img.type === "png" ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes),
      IMAGE_EMBED_TIMEOUT_MS,
      "image embed",
    );
  } catch (e) {
    console.warn("[pdf-export] image embed failed", e);
    onWarning?.("image-skipped", e);
    return null;
  }
}

// ---------- Text layout helpers ----------

/** Measure a single character; if the glyph is missing, fall back to an
 *  approximate CJK-ish width so wrapping still works (instead of silently
 *  dropping the char). */
function charWidth(font: PDFFont, ch: string, size: number): number {
  try {
    return font.widthOfTextAtSize(ch, size);
  } catch {
    // ~1em for CJK, ~0.5em for ASCII fallback approximation
    return /[\x20-\x7e]/.test(ch) ? size * 0.55 : size * 1.0;
  }
}

/** Char-by-char width-aware wrap (works for CJK without spaces and for ASCII). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = (text ?? "").split("\n");
  for (const para of paragraphs) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let current = "";
    let currentW = 0;
    for (const ch of Array.from(para)) {
      const w = charWidth(font, ch, size);
      if (currentW + w > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
        currentW = w;
      } else {
        current += ch;
        currentW += w;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

/** Try-safe drawText. If a glyph is missing, substitute with "·" (never drop
 *  the whole string). */
function safeDrawText(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color?: ReturnType<typeof rgb> },
) {
  if (!text) return;
  try {
    page.drawText(text, { x: opts.x, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
    return;
  } catch {
    // fall through to per-char substitution
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
    page.drawText(safe, { x: opts.x, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
  } catch {
    /* give up silently */
  }
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

// ---------- Date helpers ----------
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function fmtDateCompact(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

const WEEKDAY_ZH = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

// ---------- Filename ----------
export function buildPdfFilename(projectName: string, date: Date): string {
  const cleaned = (projectName || "trip")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 40) || "trip";
  return `${cleaned}_${fmtDateCompact(date)}.pdf`;
}

// ---------- Per-item cost helpers (mirror ItineraryList) ----------
function perPerson(item: ItineraryItem): number {
  if (!item.price || item.price <= 0) return 0;
  const p = item.persons || 1;
  return Math.round(item.price / p);
}

function dayTotal(items: ItineraryItem[]): number {
  return items.reduce((s, i) => s + perPerson(i), 0);
}

// ---------- Page management ----------
interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  fontEmoji: PDFFont | null;
  page: PDFPage;
  y: number; // current top y of next content
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN) {
    newPage(ctx);
  }
}

/** Width of a single emoji glyph using the emoji font (or fallback width). */
function emojiWidth(fontEmoji: PDFFont | null, emoji: string, size: number): number {
  if (!fontEmoji) return size * 1.15;
  try {
    return fontEmoji.widthOfTextAtSize(emoji, size);
  } catch {
    return size * 1.15;
  }
}

/** Draw an emoji at (x, y) using the emoji font. Returns advance width drawn. */
function drawEmoji(
  page: PDFPage,
  fontEmoji: PDFFont | null,
  emoji: string,
  x: number,
  y: number,
  size: number,
): number {
  if (!fontEmoji) return 0;
  try {
    page.drawText(emoji, { x, y, size, font: fontEmoji, color: TEXT });
    return fontEmoji.widthOfTextAtSize(emoji, size);
  } catch {
    return 0;
  }
}

// ---------- Main export ----------
export interface ExportOptions {
  /** Optional override of "now" — defaults to current time, used in cover. */
  now?: Date;
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void;
}

export async function exportProjectToPdf(
  project: TravelProject,
  opts: ExportOptions = {},
): Promise<Uint8Array> {
  console.info("[pdf-export] start export", { projectId: project.id, projectName: project.name });
  try {
    return await buildProjectPdfBytes(project, opts);
  } catch (e) {
    console.info("[pdf-export] create pdf fail", { error: e });
    throw e;
  }
}

async function buildProjectPdfBytes(
  project: TravelProject,
  opts: ExportOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { font, fontBold, fontEmoji } = await embedPdfFonts(doc, opts.onWarning);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { doc, font, fontBold, fontEmoji, page, y: PAGE_H - MARGIN };

  // ============ COVER ============
  await drawCover(ctx, project, opts.now ?? new Date(), opts.onWarning);

  // ============ EACH DAY ============
  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  for (const day of itinerary) {
    if (!day) continue;
    newPage(ctx);
    drawDayHeader(ctx, day);
    const items = Array.isArray(day.items) ? day.items : [];
    if (items.length === 0) {
      ensureSpace(ctx, 40);
      safeDrawText(ctx.page, "（這天沒有行程）", {
        x: MARGIN,
        y: ctx.y - 20,
        size: 11,
        font,
        color: MUTED,
      });
      ctx.y -= 40;
      continue;
    }
    // Order:
    //  - With time → sorted by start time.
    //  - Without time → preserve user-defined order (sortOrder, then original).
    const indexed = items.map((it, i) => ({ it, i }));
    const wt = indexed
      .filter(({ it }) => !!it.startTime)
      .sort((a, b) => a.it.startTime.localeCompare(b.it.startTime))
      .map((x) => x.it);
    const wo = indexed
      .filter(({ it }) => !it.startTime)
      .sort((a, b) => {
        const ao = a.it.sortOrder ?? a.i;
        const bo = b.it.sortOrder ?? b.i;
        return ao - bo;
      })
      .map((x) => x.it);
    const ordered = [...wt, ...wo];
    for (const item of ordered) {
      await drawItemCard(ctx, item, opts.onWarning);
    }

    // Day footer: 今日單人花費 (only if > 0)
    const total = dayTotal(items);
    if (total > 0) {
      ensureSpace(ctx, 42);
      ctx.y -= 6;
      safeDrawText(ctx.page, "今日單人花費：", {
        x: MARGIN,
        y: ctx.y - 12,
        size: 11,
        font,
        color: MUTED,
      });
      const amount = `$${total.toLocaleString()}`;
      safeDrawText(ctx.page, amount, {
        x: MARGIN,
        y: ctx.y - 32,
        size: 18,
        font: fontBold,
        color: PRIMARY,
      });
      ctx.y -= 44;
    }
  }

  const bytes = await withTimeout(doc.save(), PDF_SAVE_TIMEOUT_MS, "PDF save");
  console.info("[pdf-export] create pdf success", { bytes: bytes.length, pages: doc.getPageCount() });
  return bytes;
}

// ---------- Cover ----------
async function drawCover(
  ctx: Ctx,
// ---------- Cover ----------
async function drawCover(
  ctx: Ctx,
  project: TravelProject,
  now: Date,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
) {
  const { page, font, fontBold, fontEmoji } = ctx;

  // Top accent bar
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 6,
    width: PAGE_W,
    height: 6,
    color: PRIMARY,
  });

  ctx.y = PAGE_H - 56;

  // PeiTravel brand label
  safeDrawText(page, "PeiTravel", {
    x: MARGIN,
    y: ctx.y - 14,
    size: 13,
    font: fontBold,
    color: PRIMARY,
  });
  ctx.y -= 30;

  // Title (旅程名稱)
  const titleLines = wrapText(project.name || "未命名行程", fontBold, 26, CONTENT_W);
  for (const line of titleLines.slice(0, 3)) {
    safeDrawText(page, line, { x: MARGIN, y: ctx.y - 26, size: 26, font: fontBold, color: TEXT });
    ctx.y -= 34;
  }
  ctx.y -= 6;

  // Date range
  const sd = safeDate(project.startDate);
  const ed = safeDate(project.endDate);
  let days = 0;
  if (sd && ed) {
    days = Math.round((ed.getTime() - sd.getTime()) / 86400000) + 1;
    const range = `${fmtDateYMD(sd)}  ─  ${fmtDateYMD(ed)}`;
    safeDrawText(page, range, { x: MARGIN, y: ctx.y - 14, size: 13, font, color: MUTED });
    ctx.y -= 24;
  }

  // Cover image (preserve ratio, no crop)
  if (project.coverImageUrl) {
    const img = await loadImage(project.coverImageUrl, onWarning);
    if (img) {
      const embedded = await embedLoadedImage(ctx.doc, img, onWarning);
      if (embedded) {
        const maxH = 300;
        const maxW = CONTENT_W;
        const ratio = embedded.width / embedded.height;
        let w = maxW;
        let h = w / ratio;
        if (h > maxH) {
          h = maxH;
          w = h * ratio;
        }
        const x = MARGIN + (CONTENT_W - w) / 2;
        page.drawImage(embedded, { x, y: ctx.y - h, width: w, height: h });
        ctx.y -= h + 24;
      }
    }
  }

  // Stats — light box
  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  const allItems = itinerary.flatMap((d) => (Array.isArray(d?.items) ? d.items : []));
  const totalPerPerson = allItems.reduce((s, i) => s + perPerson(i), 0);
  const totalRaw = allItems.reduce((s, i) => s + (i.price ?? 0), 0);
  const maxPersons = allItems.reduce((m, i) => Math.max(m, i.persons || 1), 1);

  const stats: Array<[string, string]> = [
    ["總天數", `${days} 天`],
    ["人數", `${maxPersons} 人`],
    ["總花費", `$${totalRaw.toLocaleString()}`],
    ["單人總花費", `$${totalPerPerson.toLocaleString()}`],
    ["匯出日期", fmtDateYMD(now)],
  ];
  const lineH = 20;
  const boxH = stats.length * lineH + 20;
  ensureSpace(ctx, boxH + 30);
  page.drawRectangle({
    x: MARGIN,
    y: ctx.y - boxH,
    width: CONTENT_W,
    height: boxH,
    color: PRIMARY_LIGHT,
  });
  let ty = ctx.y - 22;
  for (const [k, v] of stats) {
    safeDrawText(page, k, { x: MARGIN + 18, y: ty, size: 11.5, font, color: MUTED });
    safeDrawText(page, v, { x: MARGIN + 130, y: ty, size: 12, font: fontBold, color: TEXT });
    ty -= lineH;
  }
  ctx.y -= boxH + 14;

  // Footer note
  safeDrawText(ctx.page, "由 PeiTravel 產生", {
    x: MARGIN,
    y: MARGIN - 10,
    size: 9,
    font,
    color: MUTED,
  });
  // Silence unused warning for fontEmoji at cover scope
  void fontEmoji;
}

// ---------- Day header (Day N｜YYYY/MM/DD) ----------
function drawDayHeader(ctx: Ctx, day: DayItinerary) {
  const { page, font, fontBold } = ctx;
  ensureSpace(ctx, 60);

  const date = safeDate(day.date);
  const dateStr = date ? fmtDateYMD(date) : "";
  const headerText = dateStr ? `Day ${day.dayNumber}｜${dateStr}` : `Day ${day.dayNumber}`;

  safeDrawText(page, headerText, {
    x: MARGIN,
    y: ctx.y - 22,
    size: 20,
    font: fontBold,
    color: PRIMARY,
  });

  if (date) {
    const sub = WEEKDAY_ZH[date.getDay()];
    safeDrawText(page, sub, {
      x: MARGIN,
      y: ctx.y - 40,
      size: 11,
      font,
      color: MUTED,
    });
  }

  // Underline accent
  page.drawLine({
    start: { x: MARGIN, y: ctx.y - 50 },
    end: { x: MARGIN + 60, y: ctx.y - 50 },
    thickness: 2,
    color: PRIMARY,
  });
  ctx.y -= 64;
}

// ---------- Item card (memory book style) ----------
async function drawItemCard(
  ctx: Ctx,
  item: ItineraryItem,
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void,
) {
  const { page, font, fontBold, fontEmoji, doc } = ctx;
  const padX = 16;
  const padY = 14;
  const accentW = 5;
  const textX = MARGIN + accentW + padX;
  const innerW = CONTENT_W - accentW - padX * 2;

  // ---- Data prep ----
  const iconType: TimelineIconType = item.iconType ?? "default";
  const iconEmoji = ICON_EMOJI[iconType];
  const iconFallback = ICON_FALLBACK_CHAR[iconType];
  const iconColor = ICON_COLOR[iconType] ?? PRIMARY;
  const timeStr = item.startTime
    ? `${item.startTime}${item.endTime ? " - " + item.endTime : ""}`
    : "未設定時間";

  const description = item.description || "";
  const descSize = 12;
  const descLineH = 17;
  // Preserve user line breaks: wrap each line independently (wrapText already splits on \n)
  const descLines = description ? wrapText(description, font, descSize, innerW) : [];

  const hasPrice = !!item.price && item.price > 0;
  const persons = item.persons || 1;
  const perPersonValue = hasPrice ? Math.round(item.price! / persons) : 0;
  // Match in-app price line: "$2000 / 2 人 = $1000"
  const priceLine = hasPrice
    ? (persons > 1
        ? `$${item.price!.toLocaleString()} / ${persons} 人 = $${perPersonValue.toLocaleString()}`
        : `$${item.price!.toLocaleString()} / 1 人`)
    : "";

  const mapUrl = item.googleMapsUrl ? sanitizeMapUrl(item.googleMapsUrl) : null;
  const mapLabel = mapUrl ? `${getMapProviderLabel(mapUrl)}（點擊開啟）` : "";

  // ---- Image (preserve aspect, no crop) ----
  let imgEmbed: PDFImage | null = null;
  if (item.imageUrl) {
    const img = await loadImage(item.imageUrl, onWarning);
    if (img) imgEmbed = await embedLoadedImage(doc, img, onWarning);
  }
  const imgMaxH = 220;
  const imgMaxW = Math.min(innerW, 360);
  let drawImgW = 0;
  let drawImgH = 0;
  if (imgEmbed) {
    const ratio = imgEmbed.width / imgEmbed.height;
    drawImgW = imgMaxW;
    drawImgH = drawImgW / ratio;
    if (drawImgH > imgMaxH) {
      drawImgH = imgMaxH;
      drawImgW = drawImgH * ratio;
    }
  }

  // ---- Height calc ----
  const timeRowH = 22;
  const descBlockH = Math.max(descLines.length, 1) * descLineH;
  const priceH = hasPrice ? 20 : 0;
  const mapH = mapUrl ? 22 : 0;
  const imgBlockH = imgEmbed ? drawImgH + 12 : 0;
  const cardH = padY + timeRowH + 4 + descBlockH + (hasPrice ? 6 : 0) + priceH + (mapUrl ? 4 : 0) + mapH + imgBlockH + padY;

  // Page break: if it doesn't fit, start a new page
  if (ctx.y - cardH - 12 < MARGIN) newPage(ctx);

  const cardTop = ctx.y;
  const cardBottom = ctx.y - cardH;

  // ---- Card background (highlight color if set, else white) ----
  const bg =
    item.highlightColor && item.highlightColor !== "none"
      ? HIGHLIGHT_RGB[item.highlightColor] ?? WHITE
      : WHITE;
  page.drawRectangle({
    x: MARGIN,
    y: cardBottom,
    width: CONTENT_W,
    height: cardH,
    color: bg,
    borderColor: CARD_BORDER,
    borderWidth: 0.8,
  });

  // Left accent bar — highlight color when set, else icon color
  const accentColor =
    item.highlightColor && item.highlightColor !== "none"
      ? HIGHLIGHT_BAR[item.highlightColor] ?? iconColor
      : iconColor;
  page.drawRectangle({
    x: MARGIN,
    y: cardBottom,
    width: accentW,
    height: cardH,
    color: accentColor,
  });

  // ---- Row 1: [emoji icon] [time] ----
  let cy = cardTop - padY - 14;
  const iconSize = 14;
  let cursorX = textX;
  if (fontEmoji) {
    const w = drawEmoji(page, fontEmoji, iconEmoji, cursorX, cy, iconSize);
    cursorX += (w > 0 ? w : iconSize * 1.15) + 6;
  } else {
    // Fallback: small colored badge with CJK char
    const badgeR = 8;
    page.drawCircle({
      x: cursorX + badgeR,
      y: cy + iconSize / 2 - 1,
      size: badgeR,
      color: iconColor,
    });
    const cs = 10;
    let cw = cs * 0.9;
    try { cw = fontBold.widthOfTextAtSize(iconFallback, cs); } catch { /* keep approx */ }
    safeDrawText(page, iconFallback, {
      x: cursorX + badgeR - cw / 2,
      y: cy + iconSize / 2 - cs / 2,
      size: cs,
      font: fontBold,
      color: WHITE,
    });
    cursorX += badgeR * 2 + 8;
  }
  safeDrawText(page, timeStr, {
    x: cursorX,
    y: cy,
    size: 12.5,
    font: fontBold,
    color: PRIMARY,
  });
  cy -= timeRowH;

  // ---- Row 2: description (preserve line breaks; not bold for journal feel) ----
  if (descLines.length === 0) {
    safeDrawText(page, "（未填寫描述）", {
      x: textX,
      y: cy,
      size: descSize,
      font,
      color: MUTED,
    });
    cy -= descLineH;
  } else {
    for (const line of descLines) {
      safeDrawText(page, line, {
        x: textX,
        y: cy,
        size: descSize,
        font,
        color: TEXT,
      });
      cy -= descLineH;
    }
  }

  // ---- Row 3: 💰 price ----
  if (hasPrice) {
    cy -= 4;
    let px = textX;
    if (fontEmoji) {
      const w = drawEmoji(page, fontEmoji, "💰", px, cy, 12);
      px += (w > 0 ? w : 14) + 5;
    }
    safeDrawText(page, priceLine, {
      x: px,
      y: cy,
      size: 11,
      font,
      color: TEXT,
    });
    cy -= priceH - 4;
  }

  // ---- Block 4: photo (preserve aspect, no crop) ----
  if (imgEmbed) {
    page.drawImage(imgEmbed, {
      x: textX,
      y: cy - drawImgH,
      width: drawImgW,
      height: drawImgH,
    });
    cy -= drawImgH + 12;
  }

  // ---- Block 5: 📍 map link (clickable) ----
  if (mapUrl) {
    cy -= 2;
    let mx = textX;
    let pinAdvance = 0;
    if (fontEmoji) {
      const w = drawEmoji(page, fontEmoji, "📍", mx, cy, 12);
      pinAdvance = (w > 0 ? w : 14) + 5;
      mx += pinAdvance;
    }
    const linkSize = 11.5;
    safeDrawText(page, mapLabel, {
      x: mx,
      y: cy,
      size: linkSize,
      font: fontBold,
      color: PRIMARY,
    });
    let lw = 0;
    try {
      lw = fontBold.widthOfTextAtSize(mapLabel, linkSize);
    } catch {
      lw = mapLabel.length * linkSize * 0.9;
    }
    page.drawLine({
      start: { x: mx, y: cy - 2 },
      end: { x: mx + lw, y: cy - 2 },
      thickness: 0.6,
      color: PRIMARY,
    });
    // Link annotation covers emoji + label so the entire row is tappable.
    addLinkAnnotation(page, mapUrl, textX - 2, cy - 4, pinAdvance + lw + 6, 18);
  }

  ctx.y = cardBottom - 10;
}


// ---------- Save / share ----------
export async function deliverPdf(bytes: Uint8Array, filename: string): Promise<"shared" | "downloaded"> {
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" });
  const triggerDownload = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // Lovable preview / desktop web should download directly; native/mobile may share if files are supported.
  const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  if (!isNative) {
    try {
      triggerDownload();
      console.info("[pdf-export] share/download success", { mode: "download" });
      return "downloaded";
    } catch (e) {
      console.info("[pdf-export] share/download fail", { mode: "download", error: e });
      throw e;
    }
  }

  // Try Web Share with file only when the environment explicitly supports files.
  try {
    const file = new File([blob], filename, { type: "application/pdf" });
    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
      share?: (data: { files?: File[]; title?: string }) => Promise<void>;
    };
    if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
      await withTimeout(nav.share({ files: [file], title: filename }), SHARE_TIMEOUT_MS, "navigator.share");
      console.info("[pdf-export] share/download success", { mode: "share" });
      return "shared";
    }
  } catch (e) {
    // user cancel or share unsupported — fall through to download
    console.warn("[pdf-export] share fallback", e);
    console.info("[pdf-export] share/download fail", { mode: "share", error: e });
  }
  // Fallback: anchor download
  try {
    triggerDownload();
    console.info("[pdf-export] share/download success", { mode: "download" });
    return "downloaded";
  } catch (e) {
    console.info("[pdf-export] share/download fail", { mode: "download", error: e });
    throw e;
  }
}
