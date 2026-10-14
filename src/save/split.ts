import { PDFDocument, PDFRef } from "pdf-lib";
import { copyDocumentStructure, detachPageLinks, pruneUnreachable, relinkPage } from "./structure";

/**
 * Split one PDF into several (pure; runs in a worker in the app). The file is
 * parsed once and every part copies its pages from it. Like any rebuild
 * save, each part keeps the bookmarks, metadata and attachments that apply
 * to it, links into other parts are dropped, and nothing from other parts
 * ends up hidden in its file.
 */
export async function splitPdf(bytes: Uint8Array, parts: readonly number[][], onProgress: (done: number) => void = () => {}): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const n = src.getPageCount();
  detachPageLinks(src, new Set(Array.from({ length: n }, (_, i) => i)));
  const out: Uint8Array[] = [];
  for (const [k, indices] of parts.entries()) {
    const valid = indices.filter((i) => i >= 0 && i < n);
    const doc = await PDFDocument.create({ updateMetadata: false });
    const copied = await doc.copyPages(src, valid);
    copied.forEach((p) => doc.addPage(p));
    const where = new Map<number, PDFRef>(valid.map((src, i) => [src, doc.getPage(i).ref]));
    const target = (_docId: string, i: number) => where.get(i);
    for (let i = 0; i < valid.length; i++) relinkPage(doc, doc.getPage(i).ref, "d", target);
    copyDocumentStructure(doc, [["d", src]], target);
    pruneUnreachable(doc);
    out.push(await doc.save({ useObjectStreams: true }));
    onProgress(k + 1);
  }
  return out;
}

/**
 * Parts from a description (1-based page numbers):
 *   { every: 5 }            1-5, 6-10, ...
 *   { ranges: "1-3, 4, 9-" } as written ("9-" = to the end)
 *   { every: 1 }            one file per page
 * Throws an Error with a readable message for invalid ranges.
 */
export function splitParts(pageCount: number, how: { every: number } | { ranges: string }): number[][] {
  if ("every" in how) {
    const k = Math.max(1, Math.floor(how.every));
    const parts: number[][] = [];
    for (let i = 0; i < pageCount; i += k) parts.push(Array.from({ length: Math.min(k, pageCount - i) }, (_, j) => i + j));
    return parts;
  }
  const parts: number[][] = [];
  for (const raw of how.ranges.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(raw) ?? /^(\d+)$/.exec(raw);
    if (!m) throw new Error(`"${raw}" is not a page range (use e.g. 1-3, 5, 9-)`);
    const a = m[1] ? Number(m[1]) : 1;
    const b = m.length > 2 ? (m[2] ? Number(m[2]) : pageCount) : a;
    if (a < 1 || b > pageCount || a > b) throw new Error(`"${raw}" is outside pages 1-${pageCount}`);
    parts.push(Array.from({ length: b - a + 1 }, (_, j) => a - 1 + j));
  }
  if (!parts.length) throw new Error("Type the page ranges, e.g. 1-3, 4-10, 11-");
  return parts;
}

/**
 * Join whole PDFs, in order, into one (bookmarks, links and attachments of
 * each are kept and point into the joined file). Password-protected files
 * must be unlocked first: open one and use "Pages from other PDF…" instead.
 */
export async function mergePdfs(files: readonly { name: string; bytes: Uint8Array }[], onProgress: (done: number) => void = () => {}): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const sources: [string, PDFDocument][] = [];
  const where = new Map<string, PDFRef>();
  for (const [k, f] of files.entries()) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(f.bytes, { updateMetadata: false });
    } catch (e) {
      if (/encrypt/i.test(String((e as Error)?.message))) throw new Error(`"${f.name}" is password-protected. Open it, then add the other files with "Pages from other PDF…".`);
      throw new Error(`"${f.name}" can't be read as a PDF.`);
    }
    const id = `d${k}`;
    const indices = src.getPageIndices();
    const copied = await out.copyPages(src, indices);
    copied.forEach((p, i) => {
      out.addPage(p);
      where.set(`${id}|${indices[i]}`, p.ref);
    });
    sources.push([id, src]);
    onProgress(k + 1);
  }
  const target = (docId: string, i: number) => where.get(`${docId}|${i}`);
  for (const [id] of sources) for (const [key, ref] of where) if (key.startsWith(`${id}|`)) relinkPage(out, ref, id, target);
  // One bookmark per merged file, named after it, so its pages stay findable.
  copyDocumentStructure(out, sources, target, files.map((f) => f.name.replace(/\.pdf$/i, "")));
  pruneUnreachable(out);
  return out.save({ useObjectStreams: true });
}

/** Page numbers typed as ranges ("1-3, 7, 10-") -> 0-based indices in that order, each once. */
export function parsePages(pageCount: number, text: string): number[] {
  return [...new Set(splitParts(pageCount, { ranges: text }).flat())];
}

/** 0-based indices -> "1-3, 7, 10-12" (sorted). */
export function rangesText(indices: Iterable<number>): string {
  const s = [...new Set(indices)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i] + 1}-${s[j] + 1}` : `${s[i] + 1}`);
    i = j + 1;
  }
  return out.join(", ");
}
