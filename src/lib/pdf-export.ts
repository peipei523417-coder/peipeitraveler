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

export function buildPdfFilename(projectName: string, date: Date): string {
  const cleaned = (projectName || "trip")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 40) || "trip";
  return `${cleaned}_${fmtDateCompact(date)}.pdf`;
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

  // ===== Cover =====
  await drawCover(doc, font, fontBold, project, opts.now ?? new Date(), opts.onWarning);

  // ===== One page per Day (snapshot + link annotations) =====
  const days = opts.capturedDays ?? [];
  for (const cap of days) {
    if (!cap.dataUrl || !cap.widthPx || !cap.heightPx) {
      opts.onWarning?.("day-snapshot-skipped", { day: cap.dayNumber });
      // Add a placeholder page so the day number is still represented
      const p = doc.addPage([PAGE_W, PAGE_H]);
      safeDrawText(p, `Day ${cap.dayNumber}`, {
        x: MARGIN,
        y: PAGE_H - MARGIN - 24,
        size: 20,
        font: fontBold,
        color: PRIMARY,
      });
      safeDrawText(p, "（無法擷取此天畫面）", {
        x: MARGIN,
        y: PAGE_H - MARGIN - 56,
        size: 12,
        font,
        color: MUTED,
      });
      continue;
    }
    await drawDaySnapshotPage(doc, cap, opts.onWarning);
  }

  console.info("pdf save start");
  const bytes = await withTimeout(doc.save(), PDF_SAVE_TIMEOUT_MS, "PDF save");
  console.info("pdf save complete", { bytes: bytes.length });
  console.info("pdf create complete", { bytes: bytes.length, pages: doc.getPageCount() });
  console.info("[pdf-export] create pdf success", { bytes: bytes.length, pages: doc.getPageCount() });
  return bytes;
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
  const maxPersons = allItems.reduce((m, i) => Math.max(m, i.persons || 1), 1);

  const stats: Array<[string, string]> = [
    ["總天數", `${days} 天`],
    ["人數", `${maxPersons} 人`],
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
    return;
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
    // Link annotations
    for (const link of cap.mapLinks) {
      if (!link.url) continue;
      const lx = x + link.xPct * drawW;
      const lw = link.wPct * drawW;
      const lh = link.hPct * drawH;
      // y from top of image → convert to bottom-origin
      const ly = yTop - link.yPct * drawH - lh;
      addLinkAnnotation(page, link.url, lx, ly, lw, lh);
    }
    return;
  }

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

  // We'll render the SAME full image on each page but shifted upward and mask
  // the margins so the visible band is exactly the selected slice.
  for (let s = 0; s < sliceBreaks.length; s++) {
    const slice = sliceBreaks[s];
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const x = MARGIN + (CONTENT_W - drawW) / 2;
    const visibleH = slice.end - slice.start;
    const yTopOfSliceInImage = slice.start; // px from image top (in PDF pts)
    // We want image-top to land at: page_top - (slice * sliceHpdf - 0) above the page top
    // i.e. image bottom y = (PAGE_H - MARGIN) + yTopOfSliceInImage - drawH
    const imageBottomY = (PAGE_H - MARGIN) + yTopOfSliceInImage - drawH;
    page.drawImage(img, { x, y: imageBottomY, width: drawW, height: drawH });
    // Mask outside the intended content slice.
    page.drawRectangle({ x: 0, y: PAGE_H - MARGIN, width: PAGE_W, height: MARGIN, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H - MARGIN - visibleH, color: rgb(1, 1, 1) });

    // Small slice indicator
    safeDrawText(page, `(${s + 1}/${sliceBreaks.length})`, {
      x: PAGE_W - MARGIN - 30,
      y: 14,
      size: 8,
      font: await doc.embedFont(StandardFonts.Helvetica),
      color: MUTED,
    });

    // Annotations whose vertical center falls within this slice
    for (const link of cap.mapLinks) {
      if (!link.url) continue;
      const linkTopInImage = link.yPct * drawH;
      const linkHpdf = link.hPct * drawH;
      const linkBottomInImage = linkTopInImage + linkHpdf;
      const sliceTop = slice.start;
      const sliceBottom = slice.end;
      if (linkBottomInImage < sliceTop || linkTopInImage > sliceBottom) continue;
      const lx = x + link.xPct * drawW;
      const lw = link.wPct * drawW;
      const clippedTop = Math.max(linkTopInImage, sliceTop);
      const clippedBottom = Math.min(linkBottomInImage, sliceBottom);
      const clippedH = clippedBottom - clippedTop;
      // Convert link top-in-image → page y (bottom-origin)
      const pageYofLinkTop = (PAGE_H - MARGIN) - (clippedTop - yTopOfSliceInImage);
      const ly = pageYofLinkTop - clippedH;
      addLinkAnnotation(page, link.url, lx, ly, lw, clippedH);
    }
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
