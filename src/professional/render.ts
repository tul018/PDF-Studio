import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import { pdfjsAssets } from "../core/documents";

export async function withPdf<T>(bytes: Uint8Array, fn: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const task = getDocument({ data: bytes.slice(), ...pdfjsAssets });
  try { return await fn(await task.promise); } finally { await task.destroy(); }
}
export async function renderPage(pdf: PDFDocumentProxy, index: number, dpi = 96) {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(dpi / 72, Math.sqrt(16e6 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport, background: "white", annotationMode: 0 }).promise;
  page.cleanup();
  return { canvas, viewport, width: base.width, height: base.height };
}
export async function sanitizedCopy(bytes: Uint8Array, progress: (fraction: number) => void = () => {}) {
  return withPdf(bytes, async pdf => {
    const out = await PDFDocument.create({ updateMetadata: false });
    for (let i = 0; i < pdf.numPages; i++) {
      const { canvas, width, height } = await renderPage(pdf, i, 200);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Page image failed")), "image/png"));
      const image = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
      out.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
      canvas.width = canvas.height = 0; progress((i + 1) / pdf.numPages);
    }
    return out.save();
  });
}

export async function pageLines(bytes: Uint8Array): Promise<string[][]> {
  return withPdf(bytes, async pdf => {
    const pages: string[][] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i); const content = await page.getTextContent();
      const lines: string[] = []; let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += (line && !line.endsWith(" ") && !item.str.startsWith(" ") ? " " : "") + item.str;
        if (item.hasEOL) { lines.push(line.trim()); line = ""; }
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(lines); page.cleanup();
    }
    return pages;
  });
}
