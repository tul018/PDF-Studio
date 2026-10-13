import { degrees, PDFDocument, rgb, type PDFPage } from "pdf-lib";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * Label printing mode: cut shipping labels out of marketplace PDFs and put
 * each on its own page the size of the label stock, turned and scaled to fit,
 * so a thermal printer (e.g. TSC TTP-244 Pro) prints them at 100%.
 *
 * Presets follow the shop's proven automation (label-pdf.mjs, lazada-label.mjs):
 *   shopee  one label per half page; empty halves are skipped
 *   lazada  the label is the top-left piece of each page (57% x 52%)
 *   page    each whole page is one label
 *   grid    rows x columns labels per page (e.g. 2 x 2 on A4); empty cells skipped
 */
export type LabelPreset = "shopee" | "lazada" | "page" | "grid";

export interface LabelOptions {
  preset: LabelPreset;
  /** Label stock size. */
  stockMm: { width: number; height: number };
  /** grid preset */
  rows?: number;
  cols?: number;
  /** lazada preset: fraction of the page kept from the top-left. */
  keepWidth?: number;
  keepHeight?: number;
  /** Redraw 1-D barcodes on the printer's dot grid (sharp bars). */
  crispBarcodes?: boolean;
  /** Enlarge "Shopee Order No. ..." on SPX labels. */
  bigOrderNumber?: boolean;
  /** Printer resolution (dots per inch) for crisp barcodes. */
  printerDpi?: number;
}

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  preset: "shopee",
  stockMm: { width: 82.6, height: 49.8 },
  rows: 2,
  cols: 2,
  keepWidth: 0.57,
  keepHeight: 0.52,
  crispBarcodes: true,
  bigOrderNumber: true,
  printerDpi: 203,
};

export const STOCK_SIZES: { name: string; width: number; height: number }[] = [
  { name: "82.6 × 49.8 mm (Shopee small)", width: 82.6, height: 49.8 },
  { name: "100 × 150 mm (4 × 6 in)", width: 100, height: 150 },
  { name: "100 × 100 mm", width: 100, height: 100 },
  { name: "A6 (105 × 148 mm)", width: 105, height: 148 },
];

/** pdf.js operator codes this module needs (passed in, so it runs in the app and in Node tests). */
export interface PdfJsOps {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
}

interface Box {
  left: number;
  bottom: number;
  right: number;
  top: number;
}
interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Barcode extends Box {
  modules: string;
}
interface Piece {
  pageIndex: number;
  box: Box;
  text: TextItem[];
  barcodes: Barcode[];
}

const MM = 72 / 25.4;
type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The pieces (label areas) of every page, in user space, before checking content. */
function cutPieces(view: number[], o: LabelOptions): Box[] {
  const [x0, y0, x1, y1] = view;
  const w = x1 - x0,
    h = y1 - y0;
  switch (o.preset) {
    case "shopee":
      return [
        { left: x0, right: x1, bottom: y0 + h / 2, top: y1 },
        { left: x0, right: x1, bottom: y0, top: y0 + h / 2 },
      ];
    case "lazada": {
      const kw = o.keepWidth ?? 0.57,
        kh = o.keepHeight ?? 0.52;
      return [{ left: x0, right: x0 + w * kw, top: y1, bottom: y1 - h * kh }];
    }
    case "grid": {
      const rows = Math.max(1, o.rows ?? 2),
        cols = Math.max(1, o.cols ?? 2);
      const out: Box[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          out.push({
            left: x0 + (w * c) / cols,
            right: x0 + (w * (c + 1)) / cols,
            top: y1 - (h * r) / rows,
            bottom: y1 - (h * (r + 1)) / rows,
          });
        }
      }
      return out;
    }
    default:
      return [{ left: x0, bottom: y0, right: x1, top: y1 }];
  }
}

const inside = (b: Box, x: number, y: number) => x >= b.left && x < b.right && y >= b.bottom && y < b.top;

/**
 * Find the labels: cut each page into pieces and keep those with content
 * (text or barcodes), plus each piece's text and barcode patterns for the
 * print-quality touches.
 */
export async function findLabels(pdf: PDFDocumentProxy, o: LabelOptions, OPS: PdfJsOps): Promise<Piece[]> {
  const pieces: Piece[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const boxes = cutPieces(page.view, o);
    const { items } = await page.getTextContent();
    const text: TextItem[] = [];
    for (const it of items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!it.str?.trim() || /^[-\s]+$/.test(it.str) || !it.transform) continue; // skip dashed cut lines
      text.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], width: it.width ?? 0, height: it.height ?? 0 });
    }
    const barcodes = await barcodeImages(page, OPS);
    boxes.forEach((box) => {
      const t = text.filter((i) => inside(box, i.x, i.y));
      const b = barcodes.filter((i) => inside(box, (i.left + i.right) / 2, (i.bottom + i.top) / 2));
      // Whole pages are always labels; cut pieces need something on them.
      if (o.preset === "page" || o.preset === "lazada" || t.length || b.length) {
        pieces.push({ pageIndex: n - 1, box, text: t, barcodes: b });
      }
    });
    page.cleanup();
  }
  return pieces;
}

/**
 * Shopee draws each 1-D barcode as an image one pixel high, one pixel per
 * module (e.g. SPX tracking: 156 x 1): its bar pattern can be read exactly.
 */
async function barcodeImages(page: PDFPageProxy, OPS: PdfJsOps): Promise<Barcode[]> {
  const ops = await page.getOperatorList();
  const found: (Box & { id: string; width: number })[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args[0]) ctm = mul(ctm, args[0] as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject && args[2] === 1 && args[1] >= 40 && ctm[1] === 0 && ctm[2] === 0) {
      const xs = [ctm[4], ctm[0] + ctm[4]],
        ys = [ctm[5], ctm[3] + ctm[5]];
      found.push({
        id: args[0],
        width: args[1],
        left: Math.min(...xs),
        right: Math.max(...xs),
        bottom: Math.min(...ys),
        top: Math.max(...ys),
      });
    }
  });
  const out: Barcode[] = [];
  for (const im of found) {
    // Images used on several pages live in the document-wide store ("g_" ids).
    // Never wait forever: without the pattern the barcode is simply printed as is.
    const store = im.id.startsWith("g_") ? page.commonObjs : page.objs;
    const img = await new Promise<{ data?: Uint8Array | Uint8ClampedArray; kind?: number } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      try {
        store.get(im.id, (v: { data?: Uint8Array; kind?: number }) => {
          clearTimeout(timer);
          resolve(v);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
    const data = img?.data;
    if (!data) continue;
    const step = data.length / im.width;
    const dark = img!.kind === 1 ? (x: number) => !((data[x >> 3] >> (7 - (x & 7))) & 1) : (x: number) => data[Math.floor(x * step)] < 128;
    const modules = Array.from({ length: im.width }, (_, x) => (dark(x) ? "1" : "0")).join("");
    if (modules.includes("1")) out.push({ left: im.left, right: im.right, bottom: im.bottom, top: im.top, modules });
  }
  return out;
}

/** "Shopee Order No. ..." line and the free slot to enlarge it into (SPX layout). */
function orderNumberLayout(items: TextItem[]): { glyphs: Box; slot: Box } | null {
  const order = items.find((i) => /^Shopee Order No\.?\s*\S+$/i.test(i.str));
  if (!order) return null;
  const h = order.height;
  const nextColumn = Math.min(
    ...items.filter((i) => i.x > order.x + order.width && Math.abs(i.y - order.y) < h).map((i) => i.x),
  );
  const glyphs = { left: order.x - 0.5, right: order.x + order.width + 0.5, bottom: order.y - 0.2 * h, top: order.y + 0.8 * h };
  const slot = {
    left: glyphs.left,
    right: Math.min(nextColumn - 12, order.x + 3 * order.width),
    bottom: order.y - 0.33 * h,
    top: order.y + 1.1 * h,
  };
  if (!(slot.right > glyphs.right)) return null;
  return { glyphs, slot };
}

interface Placement {
  box: Box;
  scale: number;
  ox: number;
  oy: number;
}

/** Redraw a barcode from its exact pattern, every module a whole number of printer dots. */
function drawCrispBarcode(label: PDFPage, b: Barcode, p: Placement, dpi: number): void {
  const dot = 72 / dpi;
  const at = (px: number, py: number) => ({ x: p.ox + (px - p.box.left) * p.scale, y: p.oy + (py - p.box.bottom) * p.scale });
  const from = at(b.left, b.bottom),
    to = at(b.right, b.top);
  const n = b.modules.length;
  const module = Math.max(1, Math.round((to.x - from.x) / n / dot)) * dot;
  const snap = (v: number) => Math.round(v / dot) * dot;
  const left = snap((from.x + to.x - module * n) / 2);
  label.drawRectangle({ x: from.x - 1, y: from.y, width: to.x - from.x + 2, height: to.y - from.y, color: rgb(1, 1, 1) });
  for (const run of b.modules.matchAll(/1+/g)) {
    label.drawRectangle({
      x: left + run.index! * module,
      y: snap(from.y),
      width: run[0].length * module,
      height: snap(to.y) - snap(from.y),
      color: rgb(0, 0, 0),
    });
  }
}

/**
 * Build the label PDF: one page per label, the stock size, label turned to
 * match the stock's orientation and scaled to fit. `pdf` is the same
 * document as `bytes`, opened with pdf.js (for finding the labels).
 */
export async function buildLabelPdf(
  bytes: Uint8Array,
  pdf: PDFDocumentProxy,
  o: LabelOptions,
  OPS: PdfJsOps,
  onProgress: (f: number) => void = () => {},
): Promise<{ bytes: Uint8Array; count: number }> {
  const pieces = await findLabels(pdf, o, OPS);
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const output = await PDFDocument.create();
  const pageW = o.stockMm.width * MM,
    pageH = o.stockMm.height * MM;
  const dpi = o.printerDpi ?? 203;
  for (const [k, piece] of pieces.entries()) {
    const page = source.getPage(piece.pageIndex);
    const { box } = piece;
    const [embedded] = await output.embedPages([page], [box]);
    const label = output.addPage([pageW, pageH]);
    const w = box.right - box.left,
      h = box.top - box.bottom;
    const rotate = w > h !== pageW > pageH;
    // Turned 90°, the label's width runs up the page and its height right-to-left.
    const scale = rotate ? Math.min(pageH / w, pageW / h) : Math.min(pageW / w, pageH / h);
    const sw = w * scale,
      sh = h * scale;
    label.drawPage(
      embedded,
      rotate
        ? { x: (pageW + sh) / 2, y: (pageH - sw) / 2, width: sw, height: sh, rotate: degrees(90) }
        : { x: (pageW - sw) / 2, y: (pageH - sh) / 2, width: sw, height: sh },
    );
    if (!rotate) {
      const place = { box, scale, ox: (pageW - sw) / 2, oy: (pageH - sh) / 2 };
      if (o.crispBarcodes) for (const b of piece.barcodes) drawCrispBarcode(label, b, place, dpi);
      const layout = o.bigOrderNumber ? orderNumberLayout(piece.text) : null;
      if (layout) {
        const at = (px: number, py: number) => ({ x: place.ox + (px - box.left) * scale, y: place.oy + (py - box.bottom) * scale });
        const { glyphs, slot } = layout;
        const gw = glyphs.right - glyphs.left,
          gh = glyphs.top - glyphs.bottom;
        const zoom = Math.min((slot.right - slot.left) / gw, (slot.top - slot.bottom) / gh);
        label.drawRectangle({
          ...at(slot.left, slot.bottom),
          width: (slot.right - slot.left) * scale,
          height: (slot.top - slot.bottom) * scale,
          color: rgb(1, 1, 1),
        });
        const [crop] = await output.embedPages([page], [glyphs]);
        const y = slot.bottom + (slot.top - slot.bottom - gh * zoom) / 2;
        label.drawPage(crop, { ...at(slot.left, y), width: gw * zoom * scale, height: gh * zoom * scale });
      }
    }
    onProgress((k + 1) / Math.max(1, pieces.length));
  }
  return { bytes: await output.save(), count: pieces.length };
}
