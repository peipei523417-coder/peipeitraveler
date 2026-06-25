/**
 * PDF export — ALL-IMAGE pipeline.
 *
 * Every PDF page is produced by:
 *   DOM node  →  html2canvas  →  JPEG  →  pdf-lib embedJpg  →  A4 page
 *
 * No pdf-lib drawText, no embedFont, no StandardFonts, no CJK font fallback.
 * This eliminates an entire class of mobile reliability bugs (garbled CJK /
 * KR / JP, missing emoji, font download timeouts, Helvetica fallback flicker).
 *
 * Memory: sequential capture, one canvas at a time, immediate JPEG, immediate
 * embed, immediate canvas release, yield between pages. 20-day itineraries
 * stay below the mobile memory budget.
 *
 * Page order:  cover → 📍 overview → Day 1..N → 導航連結 (consolidated)
 *              → 🎉 旅途順利.
 *
 * Hyperlinks: map-link cards in the consolidated section get real PDF link
 * annotations so iOS Files / Android PDF Viewer / Adobe Reader / Mac Preview
 * can all open the underlying map URL.
 */

import { PDFDocument, PDFPage, rgb, PDFName, PDFString, PDFArray } from "pdf-lib";
import type { TravelProject } from "@/types/travel";
import { PDF_CAPTURE_WIDTH } from "@/components/PdfCaptureRoot";

const HTML2CANVAS_TIMEOUT_MS = 18000;
const IMAGE_EMBED_TIMEOUT_MS = 8000;
const PDF_SAVE_TIMEOUT_MS = 180000;
const SHARE_TIMEOUT_MS = 12000;

// A4
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CONTENT_H = PAGE_H - MARGIN * 2;

export type PdfExportWarning = "image-skipped" | "day-snapshot-skipped" | "section-skipped";
export type PdfExportStage = "cover" | "overview" | "day" | "maplinks" | "end" | "finalize";

export interface PdfProgress {
  stage: PdfExportStage;
  dayIndex?: number;
  totalDays?: number;
}

export interface ExportOptions {
  now?: Date;
  onWarning?: (warning: PdfExportWarning, detail?: unknown) => void;
  onProgress?: (p: PdfProgress) => void;
  /** DOM root rendered by PdfCaptureRoot. Required for snapshot export. */
  captureRoot?: HTMLElement | null;
}

// ---------- Helpers ----------
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

function yieldToLoop(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function fmtDateCompact(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function buildPdfFilename(projectName: string, tripStart: Date | string | undefined | null): string {
  const cleaned = (projectName || "trip")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 40) || "trip";
  let compact = "";
  if (typeof tripStart === "string") {
    const m = tripStart.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) compact = `${m[1]}${m[2]}${m[3]}`;
  } else if (tripStart instanceof Date && !isNaN(tripStart.getTime())) {
    compact = fmtDateCompact(tripStart);
  }
  if (!compact) compact = fmtDateCompact(new Date());
  return `${cleaned}_${compact}.pdf`;
}

// ---------- html2canvas profile ----------
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
  return { isMobile, scale: isMobile ? 1.2 : 2, jpegQuality: isMobile ? 0.9 : 0.85 };
}

interface CaptureResult {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** CSS-px width of the captured node (for mapping link rects). */
  nodeCssWidth: number;
  /** CSS-px height of the captured node. */
  nodeCssHeight: number;
}

async function captureNode(
  html2canvas: Html2Canvas,
  node: HTMLElement,
  scale: number,
  jpegQuality: number,
  label: string,
): Promise<CaptureResult | null> {
  const rect = node.getBoundingClientRect();
  const cssW = Math.ceil(node.scrollWidth || rect.width || PDF_CAPTURE_WIDTH);
  const cssH = Math.ceil(node.scrollHeight || rect.height || 1);
  let canvas: HTMLCanvasElement | null = null;
  const baseOpts = {
    backgroundColor: "#ffffff",
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: 6000,
    windowWidth: PDF_CAPTURE_WIDTH,
    width: cssW,
    height: cssH,
    scrollX: 0,
    scrollY: 0,
  } as const;
  try {
    canvas = await withTimeout(html2canvas(node, baseOpts), HTML2CANVAS_TIMEOUT_MS, label);
    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    return { dataUrl, widthPx: canvas.width, heightPx: canvas.height, nodeCssWidth: cssW, nodeCssHeight: cssH };
  } catch (e) {
    console.warn("[pdf-export] capture failed, retrying without images", label, e);
    if (canvas) {
      try { canvas.width = 0; canvas.height = 0; } catch { /* ignore */ }
      canvas = null;
    }
    // Fallback (e.g. Lovable Preview iframe where image CORS can taint the
    // canvas and toDataURL throws SecurityError): retry skipping <img> tags
    // so the rest of the page still exports. Mobile/native runs hit the
    // primary path and keep their images.
    try {
      canvas = await withTimeout(
        html2canvas(node, {
          ...baseOpts,
          ignoreElements: (el: Element) => el.tagName === "IMG",
        }),
        HTML2CANVAS_TIMEOUT_MS,
        `${label} (no-img retry)`,
      );
      const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
      return { dataUrl, widthPx: canvas.width, heightPx: canvas.height, nodeCssWidth: cssW, nodeCssHeight: cssH };
    } catch (e2) {
      console.warn("[pdf-export] capture retry also failed", label, e2);
      return null;
    }
  } finally {
    if (canvas) {
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------- Link rects (for map-link annotations) ----------
interface LinkRect {
  url: string;
  /** Fractions of nodeCssHeight / nodeCssWidth. */
  topPct: number;
  bottomPct: number;
  leftPct: number;
  rightPct: number;
}

function collectLinkRects(node: HTMLElement): LinkRect[] {
  const nodeRect = node.getBoundingClientRect();
  const w = nodeRect.width || 1;
  const h = nodeRect.height || 1;
  return Array.from(node.querySelectorAll<HTMLElement>("[data-pdf-link]")).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      url: el.getAttribute("data-pdf-link") || "",
      topPct: (r.top - nodeRect.top) / h,
      bottomPct: (r.bottom - nodeRect.top) / h,
      leftPct: (r.left - nodeRect.left) / w,
      rightPct: (r.right - nodeRect.left) / w,
    };
  });
}

interface CardBound {
  topPct: number;
  bottomPct: number;
}

function collectCardBounds(node: HTMLElement): CardBound[] {
  const nodeRect = node.getBoundingClientRect();
  const h = nodeRect.height || 1;
  return Array.from(node.querySelectorAll<HTMLElement>("[data-pdf-card]")).map((card) => {
    const r = card.getBoundingClientRect();
    return { topPct: (r.top - nodeRect.top) / h, bottomPct: (r.bottom - nodeRect.top) / h };
  });
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
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
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

// ---------- Place captured node into PDF (slice if too tall) ----------
async function placeCapturedNode(
  doc: PDFDocument,
  cap: CaptureResult,
  cardBounds: CardBound[],
  linkRects: LinkRect[],
): Promise<void> {
  const base64 = cap.dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const isPng = cap.dataUrl.startsWith("data:image/png");
  const img = await withTimeout(
    isPng ? doc.embedPng(bytes) : doc.embedJpg(bytes),
    IMAGE_EMBED_TIMEOUT_MS,
    "node snapshot embed",
  );

  const imgRatio = img.width / img.height;
  const drawW = CONTENT_W;
  const drawH = drawW / imgRatio;

  if (drawH <= CONTENT_H) {
    // Fits on one page.
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const x = MARGIN;
    const yBottom = (PAGE_H - MARGIN) - drawH;
    page.drawImage(img, { x, y: yBottom, width: drawW, height: drawH });
    // Link annotations
    for (const lr of linkRects) {
      const lx = x + lr.leftPct * drawW;
      const lw = (lr.rightPct - lr.leftPct) * drawW;
      const lTopOnImage = lr.topPct * drawH;
      const lBotOnImage = lr.bottomPct * drawH;
      const ly = (PAGE_H - MARGIN) - lBotOnImage;
      const lh = lBotOnImage - lTopOnImage;
      addLinkAnnotation(page, lr.url, lx, ly, lw, lh);
    }
    return;
  }

  // Slice into multiple A4 pages, preferring breaks between cards.
  const slices: Array<{ start: number; end: number }> = [];
  const minUsefulSlice = CONTENT_H * 0.35;
  const bounds = cardBounds
    .map((b) => ({ top: b.topPct * drawH, bottom: b.bottomPct * drawH }))
    .filter((b) => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top)
    .sort((a, b) => a.top - b.top);

  let s = 0;
  while (s < drawH - 1) {
    let e = Math.min(s + CONTENT_H, drawH);
    if (e < drawH) {
      const crossing = bounds.find((b) => b.top < e && b.bottom > e);
      if (crossing && crossing.top - s >= minUsefulSlice) {
        e = crossing.top;
      }
    }
    if (e <= s + 8) e = Math.min(s + CONTENT_H, drawH);
    slices.push({ start: s, end: e });
    s = e;
  }

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const visibleH = slice.end - slice.start;
    const x = MARGIN;
    // Position the full scaled image so that slice.start of image aligns with page top.
    const imageBottomY = (PAGE_H - MARGIN) + slice.start - drawH;
    page.drawImage(img, { x, y: imageBottomY, width: drawW, height: drawH });
    // Mask outside slice.
    page.drawRectangle({ x: 0, y: PAGE_H - MARGIN, width: PAGE_W, height: MARGIN, color: rgb(1, 1, 1) });
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: PAGE_H - MARGIN - visibleH,
      color: rgb(1, 1, 1),
    });
    // Link annotations within this slice
    for (const lr of linkRects) {
      const lTopOnImage = lr.topPct * drawH;
      const lBotOnImage = lr.bottomPct * drawH;
      const linkMid = (lTopOnImage + lBotOnImage) / 2;
      if (linkMid < slice.start || linkMid > slice.end) continue;
      const clippedTop = Math.max(lTopOnImage, slice.start);
      const clippedBot = Math.min(lBotOnImage, slice.end);
      const lx = x + lr.leftPct * drawW;
      const lw = (lr.rightPct - lr.leftPct) * drawW;
      const ly = (PAGE_H - MARGIN) - (clippedBot - slice.start);
      const lh = clippedBot - clippedTop;
      addLinkAnnotation(page, lr.url, lx, ly, lw, lh);
    }
  }
}

// ---------- Main export ----------
export async function exportProjectToPdf(
  project: TravelProject,
  opts: ExportOptions,
): Promise<Uint8Array> {
  console.info("[pdf-export] PDF snapshot export start", {
    projectId: project.id,
    hasCaptureRoot: !!opts.captureRoot,
  });
  const root = opts.captureRoot;
  if (!root) throw new Error("PDF export requires captureRoot DOM element");

  const doc = await PDFDocument.create();
  const html2canvas = await loadHtml2Canvas();
  const profile = captureProfile();
  console.info("[pdf-export] capture profile", profile);

  const itinerary = Array.isArray(project.itinerary) ? project.itinerary : [];
  const totalDays = itinerary.length;

  // ---- 1. Cover ----
  opts.onProgress?.({ stage: "cover" });
  const coverNode = root.querySelector<HTMLElement>("[data-pdf-cover]");
  if (coverNode) {
    const shot = await captureNode(html2canvas, coverNode, profile.scale, profile.jpegQuality, "capture cover");
    if (shot) {
      try {
        await placeCapturedNode(doc, shot, [], []);
      } catch (e) {
        console.warn("[pdf-export] cover embed failed", e);
        opts.onWarning?.("section-skipped", { section: "cover", error: e });
      }
      shot.dataUrl = "";
    } else {
      opts.onWarning?.("section-skipped", { section: "cover" });
    }
    await yieldToLoop();
  }

  // ---- 2. Overview ----
  opts.onProgress?.({ stage: "overview" });
  const overviewNode = root.querySelector<HTMLElement>("[data-pdf-overview]");
  if (overviewNode) {
    const cards = collectCardBounds(overviewNode);
    const shot = await captureNode(html2canvas, overviewNode, profile.scale, profile.jpegQuality, "capture overview");
    if (shot) {
      try {
        await placeCapturedNode(doc, shot, cards, []);
      } catch (e) {
        console.warn("[pdf-export] overview embed failed", e);
        opts.onWarning?.("section-skipped", { section: "overview", error: e });
      }
      shot.dataUrl = "";
    }
    await yieldToLoop();
  }

  // ---- 3. Days (sequential) ----
  const dayNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-day]"));
  for (let i = 0; i < dayNodes.length; i++) {
    const node = dayNodes[i];
    const dayNumber = Number(node.dataset.pdfDay);
    opts.onProgress?.({ stage: "day", dayIndex: i + 1, totalDays });
    const cards = collectCardBounds(node);
    const shot = await captureNode(
      html2canvas,
      node,
      profile.scale,
      profile.jpegQuality,
      `capture day${dayNumber}`,
    );
    if (shot) {
      try {
        await placeCapturedNode(doc, shot, cards, []);
      } catch (e) {
        console.warn("[pdf-export] day embed failed", { day: dayNumber, error: e });
        opts.onWarning?.("day-snapshot-skipped", { day: dayNumber, error: e });
        await drawFallbackPage(doc, `Day ${dayNumber}`, "此天畫面匯出失敗，請回 App 查看完整內容。");
      }
      shot.dataUrl = "";
    } else {
      opts.onWarning?.("day-snapshot-skipped", { day: dayNumber });
      await drawFallbackPage(doc, `Day ${dayNumber}`, "此天畫面匯出失敗，請回 App 查看完整內容。");
    }
    await yieldToLoop();
  }

  // ---- 4. Map links (consolidated, with hyperlinks) ----
  opts.onProgress?.({ stage: "maplinks" });
  const linksNode = root.querySelector<HTMLElement>("[data-pdf-maplinks]");
  if (linksNode) {
    const cards = collectCardBounds(linksNode);
    const links = collectLinkRects(linksNode);
    const shot = await captureNode(html2canvas, linksNode, profile.scale, profile.jpegQuality, "capture maplinks");
    if (shot) {
      try {
        await placeCapturedNode(doc, shot, cards, links);
      } catch (e) {
        console.warn("[pdf-export] maplinks embed failed", e);
        opts.onWarning?.("section-skipped", { section: "maplinks", error: e });
      }
      shot.dataUrl = "";
    }
    await yieldToLoop();
  }

  // ---- 5. End page ----
  opts.onProgress?.({ stage: "end" });
  const endNode = root.querySelector<HTMLElement>("[data-pdf-end]");
  if (endNode) {
    // Ensure brand image(s) are fully loaded + decoded before capture.
    // Mobile (iOS/Android WebView) sometimes triggers html2canvas before the
    // CDN-hosted brand asset is ready, producing a blank last page.
    try {
      const imgs = Array.from(endNode.querySelectorAll("img"));
      await Promise.all(
        imgs.map(async (img) => {
          try {
            if (!(img.complete && img.naturalWidth > 0)) {
              await new Promise<void>((resolve) => {
                const done = () => resolve();
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
                setTimeout(done, 6000);
              });
            }
            if (typeof img.decode === "function") {
              await img.decode().catch(() => undefined);
            }
          } catch {
            /* ignore */
          }
        }),
      );
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    } catch (e) {
      console.warn("[pdf-export] end brand image wait failed", e);
    }

    const shot = await captureNode(html2canvas, endNode, profile.scale, profile.jpegQuality, "capture end");
    if (shot) {
      try {
        await placeCapturedNode(doc, shot, [], []);
      } catch (e) {
        console.warn("[pdf-export] end embed failed", e);
        opts.onWarning?.("section-skipped", { section: "end", error: e });
      }
      shot.dataUrl = "";
    }
    await yieldToLoop();
  }

  opts.onProgress?.({ stage: "finalize" });
  console.info("[pdf-export] PDF save start", { pages: doc.getPageCount() });
  const bytes = await withTimeout(doc.save(), PDF_SAVE_TIMEOUT_MS, "PDF save");
  console.info("[pdf-export] PDF save done", { bytes: bytes.length, pages: doc.getPageCount() });
  return bytes;
}

// ---------- Fallback (text-free) ----------
// When a single Day capture fails we insert a minimal blank page so the rest
// of the export still succeeds. No text drawing — only a coloured stripe so
// users can see something happened and we never hit a CJK glyph issue.
async function drawFallbackPage(doc: PDFDocument, _title: string, _msg: string): Promise<void> {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: rgb(0.008, 0.522, 0.78) });
  // Subtle marker box so blank page is intentional, not a bug.
  page.drawRectangle({
    x: MARGIN,
    y: PAGE_H / 2 - 20,
    width: CONTENT_W,
    height: 40,
    color: rgb(0.95, 0.97, 1),
    borderColor: rgb(0.84, 0.9, 0.97),
    borderWidth: 0.8,
  });
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
          await withTimeout(nav.share({ files: [file], title: filename }), SHARE_TIMEOUT_MS, "navigator.share");
          return "shared";
        }
      } catch (e) {
        console.warn("[pdf-export] web share fallback", e);
      }
    }
    triggerDownload();
    return "downloaded";
  }

  try {
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
      Share.share({ title: filename, files: [writeResult.uri], dialogTitle: filename }),
      SHARE_TIMEOUT_MS,
      "native share",
    );
    return "shared";
  } catch (e) {
    console.warn("[pdf-export] share fallback", e);
  }
  triggerDownload();
  return "downloaded";
}
