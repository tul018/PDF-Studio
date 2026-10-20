import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsAssets } from "../core/documents";
import type { Sheet } from "../print/layout";

/**
 * Printing the *edited* document: the bytes Save would write are opened once
 * (for the preview and the print), and each sheet is drawn into a compressed
 * picture one at a time, so even a 500-page job holds one bitmap at a time.
 */
export interface PrintJob {
  doc: PDFDocumentProxy;
  /** Page size in points as shown (rotation applied), 0-based. */
  sizes: [number, number][];
  close(): Promise<void>;
}

export async function openPrintJob(bytes: Uint8Array): Promise<PrintJob> {
  const task = getDocument({ data: bytes, ...pdfjsAssets } as Parameters<typeof getDocument>[0]);
  const doc = await task.promise;
  const sizes: [number, number][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push([vp.width, vp.height]);
  }
  return { doc, sizes, close: () => task.destroy() };
}

export interface SheetStyle {
  /** Paper in points (portrait), or null = each page's own size (one per sheet). */
  paper: [number, number] | null;
  gray: boolean;
}

/** Sheet size in points. */
export function sheetSize(job: PrintJob, sheet: Sheet, style: SheetStyle): [number, number] {
  if (!style.paper) {
    const first = sheet.cells.find((c) => c !== null);
    return first == null ? [595.28, 841.89] : job.sizes[first];
  }
  const [w, h] = style.paper;
  return sheet.landscape ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

/** Draw one sheet at `dpi`: each page scaled to fit its cell, centered. */
export async function drawSheet(job: PrintJob, sheet: Sheet, style: SheetStyle, dpi: number): Promise<HTMLCanvasElement> {
  const k = dpi / 72;
  const [sw, sh] = sheetSize(job, sheet, style);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Own-size pages fill the sheet; on paper, a small margin and gap.
  const multi = sheet.cells.length > 1;
  const margin = style.paper && multi ? 14 : 0;
  const gap = multi ? 8 : 0;
  const cw = (sw - margin * 2 - gap * (sheet.cols - 1)) / sheet.cols;
  const ch = (sh - margin * 2 - gap * (sheet.rows - 1)) / sheet.rows;
  for (const [n, index] of sheet.cells.entries()) {
    if (index === null) continue;
    const page = await job.doc.getPage(index + 1);
    const [pw, ph] = job.sizes[index];
    const fit = Math.min(cw / pw, ch / ph);
    const vp = page.getViewport({ scale: fit * k });
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.round(vp.width));
    tmp.height = Math.max(1, Math.round(vp.height));
    await page.render({ canvas: tmp, viewport: vp, background: "white" } as Parameters<typeof page.render>[0]).promise;
    const col = n % sheet.cols;
    const row = Math.floor(n / sheet.cols);
    const x = Math.round((margin + col * (cw + gap) + (cw - pw * fit) / 2) * k);
    const y = Math.round((margin + row * (ch + gap) + (ch - ph * fit) / 2) * k);
    ctx.filter = style.gray ? "grayscale(1)" : "none";
    ctx.drawImage(tmp, x, y);
    ctx.filter = "none";
    if (multi) {
      ctx.strokeStyle = "#ccc";
      ctx.lineWidth = Math.max(1, k * 0.5);
      ctx.strokeRect(x, y, tmp.width, tmp.height);
    }
    tmp.width = tmp.height = 0;
    page.cleanup();
  }
  return canvas;
}

const PT_MM = 25.4 / 72;

/** Draw every sheet as a picture and open the system print dialog (printer, copies, two-sided). */
export async function printSheets(
  job: PrintJob,
  sheets: Sheet[],
  style: SheetStyle,
  onProgress: (f: number) => void,
  signal: AbortSignal,
  dpi = 150,
): Promise<void> {
  const root = document.createElement("div");
  root.id = "print-root";
  const pageStyle = document.createElement("style");
  if (style.paper) {
    // Named pages: an upright and a sideways sheet can share one job.
    const [w, h] = style.paper.map((v) => +(v * PT_MM).toFixed(2));
    const [a, b] = [Math.min(w, h), Math.max(w, h)];
    pageStyle.textContent = `@media print {
      @page sheet-p { size: ${a}mm ${b}mm; margin: 0; }
      @page sheet-l { size: ${b}mm ${a}mm; margin: 0; }
      #print-root img.sheet-p { page: sheet-p; width: ${a}mm !important; height: ${b}mm !important; max-width: none; max-height: none; }
      #print-root img.sheet-l { page: sheet-l; width: ${b}mm !important; height: ${a}mm !important; max-width: none; max-height: none; }
    }`;
  }
  document.head.appendChild(pageStyle);
  const urls: string[] = [];
  try {
    for (const [i, sheet] of sheets.entries()) {
      if (signal.aborted) return;
      const canvas = await drawSheet(job, sheet, style, dpi);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.92));
      canvas.width = canvas.height = 0;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.className = sheet.landscape ? "sheet-l" : "sheet-p";
      root.appendChild(img);
      onProgress((i + 1) / sheets.length);
    }
    document.body.appendChild(root);
    await Promise.all([...root.querySelectorAll("img")].map((im) => im.decode().catch(() => {})));
    window.print();
  } finally {
    setTimeout(() => {
      root.remove();
      pageStyle.remove();
      urls.forEach((u) => URL.revokeObjectURL(u));
    }, 1000);
  }
}
