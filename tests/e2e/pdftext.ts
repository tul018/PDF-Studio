// Node-side helpers to inspect saved PDFs.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  await task.destroy();
  return out;
}

export async function pageInfo(bytes: Uint8Array): Promise<{ rotate: number; w: number; h: number }[]> {
  const task = getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    out.push({ rotate: p.rotate, w: p.view[2] - p.view[0], h: p.view[3] - p.view[1] });
  }
  await task.destroy();
  return out;
}
