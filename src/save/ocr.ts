import { getDocument } from "pdfjs-dist";
import { degrees, PDFDocument } from "pdf-lib";
import { createWorker } from "tesseract.js";
import { pdfjsAssets } from "../core/documents";

/**
 * OCR: make scanned pages searchable, offline (Tesseract, bundled with the
 * app: Thai, Chinese and English). Each page is rendered at 300 dpi as the
 * reader sees it, recognized, and Tesseract's invisible text layer (its own
 * PDF renderer, with a glyph-less font covering every script) is placed over
 * the page. The pages look exactly the same; their text can be searched,
 * selected and copied - in PDF Studio and in any other PDF app.
 */
export type OcrLang = "tha" | "eng" | "chi_sim";

export interface OcrOptions {
  langs: OcrLang[];
  /** 0-based pages of the document to recognize. */
  pages: number[];
  /** Skip pages that already have text (not scans). */
  skipText: boolean;
}

const base = new URL("tesseract/", document.baseURI).href;

export async function ocrPdf(
  bytes: Uint8Array,
  o: OcrOptions,
  onProgress: (label: string, f: number) => void,
): Promise<{ bytes: Uint8Array; recognized: number; skipped: number }> {
  onProgress("Starting text recognition…", 0);
  const worker = await createWorker(o.langs.join("+"), 1, {
    workerPath: base + "worker.min.js",
    // An explicit file: a folder would make it look for CPU-specific variants we do not ship.
    corePath: base + "tesseract-core-simd-lstm.wasm.js",
    langPath: base + "lang",
    gzip: true,
    workerBlobURL: false,
    cacheMethod: "none",
  });
  const task = getDocument({ data: bytes.slice(), ...pdfjsAssets } as Parameters<typeof getDocument>[0]);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  let recognized = 0,
    skipped = 0;
  try {
    const pdf = await task.promise;
    for (const [k, i] of o.pages.entries()) {
      onProgress(`Recognizing page ${i + 1} (${k + 1} of ${o.pages.length})…`, k / o.pages.length);
      const page = await pdf.getPage(i + 1);
      if (o.skipText) {
        const tc = await page.getTextContent();
        const chars = (tc.items as { str?: string }[]).reduce((n, t) => n + (t.str?.trim().length ?? 0), 0);
        if (chars > 20) {
          skipped++;
          continue;
        }
      }
      const rotation = page.rotate;
      const MAX = 40e6;
      const vp1 = page.getViewport({ scale: 1, rotation });
      const scale = Math.min(300 / 72, Math.sqrt(MAX / (vp1.width * vp1.height)));
      const vp = page.getViewport({ scale, rotation });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvas, viewport: vp, background: "white" } as Parameters<typeof page.render>[0]).promise;
      page.cleanup();
      const { data } = await worker.recognize(canvas, { pdfTitle: "OCR", pdfTextOnly: true }, { pdf: true, text: false, blocks: false });
      canvas.width = canvas.height = 0;
      const textPdf = await PDFDocument.load(new Uint8Array(data.pdf as unknown as number[]));
      const [form] = await out.embedPages([textPdf.getPage(0)]);
      placeOver(out.getPage(i), form, rotation, vp1.width, vp1.height);
      recognized++;
    }
  } finally {
    await worker.terminate();
    await task.destroy();
  }
  onProgress("Saving…", 1);
  return { bytes: await out.save({ useObjectStreams: true }), recognized, skipped };
}

/**
 * Put the recognized text layer (in "as displayed" orientation, wd x hd
 * points) over the page's visible area, turned back by the page's rotation.
 */
function placeOver(
  page: ReturnType<PDFDocument["getPage"]>,
  form: Awaited<ReturnType<PDFDocument["embedPages"]>>[number],
  rotation: number,
  wd: number,
  hd: number,
): void {
  const { x: x0, y: y0, width: wu, height: hu } = page.getCropBox();
  const r = ((rotation % 360) + 360) % 360;
  // Display rotation is clockwise; drawing rotates counter-clockwise about (x, y).
  const at =
    r === 90 ? { x: x0 + wu, y: y0 } : r === 180 ? { x: x0 + wu, y: y0 + hu } : r === 270 ? { x: x0, y: y0 + hu } : { x: x0, y: y0 };
  page.drawPage(form, { ...at, width: wd, height: hd, rotate: degrees(r) });
}
