import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { DocId, PageRef } from "../edit/model";
import { uid } from "../edit/model";
import { SourceRangeTransport, type PdfSource } from "./source";
import type { Size } from "./layout";

GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = new URL("pdfjs/", document.baseURI).href;

/**
 * Bundled PDF.js data (CMaps for Chinese/Japanese/Korean, standard fonts,
 * image decoders, colour profiles). Every getDocument() in the app needs
 * these, or non-embedded CJK fonts, JPEG2000 scans etc. come out wrong.
 */
export const pdfjsAssets = {
  cMapUrl: assetBase + "cmaps/",
  cMapPacked: true,
  standardFontDataUrl: assetBase + "standard_fonts/",
  wasmUrl: assetBase + "wasm/",
  iccUrl: assetBase + "iccs/",
  useSystemFonts: true,
};

export interface PageMeta {
  /** [x0, y0, x1, y1] user-space view box (CropBox). */
  view: number[];
  /** Intrinsic /Rotate. */
  rotate: number;
}

export interface LoadedDoc {
  id: DocId;
  source: PdfSource;
  pdf: PDFDocumentProxy;
  /** Destroying the loading task terminates the worker-side document. */
  task: { destroy(): Promise<void> };
  numPages: number;
  encrypted: boolean;
  /** The password it was opened with (memory only), to protect saved copies the same way. */
  password?: string;
}

export type PasswordPrompt = (reason: "need" | "incorrect") => Promise<string | null>;

/**
 * Owns every open PDFDocumentProxy (the main file plus any merged files) and
 * caches lightweight page metadata so the virtual layout can be computed
 * without parsing pages.
 */
export class DocumentStore {
  readonly docs = new Map<DocId, LoadedDoc>();
  /** Per document, indexed by page: plain arrays, since this is hit on every frame. */
  private meta = new Map<DocId, (PageMeta | undefined)[]>();
  private metaPending = new Map<string, Promise<PageMeta>>();
  private sizeListeners = new Set<(docId: DocId, indices: readonly number[]) => void>();
  /** Sizes loaded but not yet announced; flushed together (see notifySize). */
  private sizeQueue = new Map<DocId, number[]>();
  private sizeFlushTimer = 0;
  private scanToken = 0;
  private transports = new Map<DocId, SourceRangeTransport>();
  /** An open file can't be read right now (`err`), or can be again (`null`). */
  onReadProblem: (source: PdfSource, err: unknown) => void = () => {};

  async open(source: PdfSource, askPassword: PasswordPrompt, onProgress?: (f: number) => void): Promise<LoadedDoc> {
    const transport = new SourceRangeTransport(source);
    let opened: LoadedDoc | null = null;
    let openError: unknown = null;
    transport.onReadProblem = (err, failures) => {
      if (opened) return this.onReadProblem(source, err);
      // Still opening: don't leave "Opening..." up forever.
      if (err && failures >= 3 && openError === null) {
        openError = err;
        transport.abort();
        void task.destroy();
      }
    };
    const task = getDocument({
      range: transport,
      length: source.size,
      rangeChunkSize: 256 * 1024,
      // Only fetch what is needed; don't stream the whole file in.
      disableAutoFetch: true,
      disableStream: true,
      cMapUrl: assetBase + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: assetBase + "standard_fonts/",
      wasmUrl: assetBase + "wasm/",
      iccUrl: assetBase + "iccs/",
      enableHWA: localStorage.getItem("pdfstudio:gpu") === "1",
      enableXfa: false,
      useSystemFonts: true,
    } as Parameters<typeof getDocument>[0]);
    let encrypted = false;
    let password: string | undefined;
    task.onPassword = (update: (pw: string) => void, reason: number) => {
      encrypted = true;
      askPassword(reason === PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "need").then((pw) => {
        if (pw === null) task.destroy();
        else {
          password = pw;
          update(pw);
        }
      });
    };
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (onProgress && total) onProgress(Math.min(1, loaded / total));
    };
    let pdf: PDFDocumentProxy;
    try {
      pdf = await task.promise;
    } catch (e) {
      if (openError === null) throw e;
      const err = new Error(`the file can't be read (${(openError as Error)?.message ?? openError})`);
      err.name = "FileReadError";
      throw err;
    }
    if (!encrypted) {
      try {
        // Encrypted-but-no-password files (permissions only) still load.
        const md = await pdf.getMetadata();
        encrypted = Boolean((md.info as Record<string, unknown>)?.EncryptFilterName);
      } catch {
        /* ignore */
      }
    }
    const doc: LoadedDoc = { id: uid("doc"), source, pdf, task, numPages: pdf.numPages, encrypted, password };
    this.docs.set(doc.id, doc);
    this.transports.set(doc.id, transport);
    opened = doc;
    await this.loadMeta(doc.id, 0); // first page = size estimate for the rest
    return doc;
  }

  async closeAll(): Promise<void> {
    this.scanToken++;
    const docs = [...this.docs.values()];
    this.docs.clear();
    for (const t of this.transports.values()) t.abort(); // stop retrying reads of closed files
    this.transports.clear();
    this.meta.clear();
    this.metaPending.clear();
    this.sizeQueue.clear();
    await Promise.all(docs.map((d) => d.task.destroy().catch(() => {})));
  }

  /** Page sizes became known: called with all pages loaded since the last call. */
  onSize(fn: (docId: DocId, indices: readonly number[]) => void): () => void {
    this.sizeListeners.add(fn);
    return () => this.sizeListeners.delete(fn);
  }

  /**
   * Announce sizes in batches, at most ~30 times a second. One relayout per
   * page made the background size scan O(pages²): seconds of main-thread
   * time (and dropped frames) on a 2000-page document.
   */
  private notifySize(docId: DocId, index: number): void {
    const q = this.sizeQueue.get(docId);
    if (q) q.push(index);
    else this.sizeQueue.set(docId, [index]);
    if (this.sizeFlushTimer) return;
    this.sizeFlushTimer = window.setTimeout(() => {
      this.sizeFlushTimer = 0;
      const batches = [...this.sizeQueue];
      this.sizeQueue.clear();
      for (const [id, indices] of batches) {
        if (!this.docs.has(id)) continue;
        for (const fn of this.sizeListeners) fn(id, indices);
      }
    }, 32);
  }

  getPage(ref: PageRef): Promise<PDFPageProxy> | null {
    if (!ref.docId) return null;
    const d = this.docs.get(ref.docId);
    if (!d) return null;
    return d.pdf.getPage(ref.srcIndex + 1);
  }

  metaOf(ref: PageRef): PageMeta | undefined {
    if (!ref.docId) return undefined;
    return this.meta.get(ref.docId)?.[ref.srcIndex];
  }

  loadMeta(docId: DocId, index: number): Promise<PageMeta> {
    const m = this.meta.get(docId)?.[index];
    if (m) return Promise.resolve(m);
    const key = `${docId}:${index}`;
    let p = this.metaPending.get(key);
    if (!p) {
      const d = this.docs.get(docId)!;
      p = d.pdf.getPage(index + 1).then((page) => {
        const meta = { view: page.view.slice(), rotate: page.rotate };
        let list = this.meta.get(docId);
        if (!list) this.meta.set(docId, (list = []));
        list[index] = meta;
        this.metaPending.delete(key);
        this.notifySize(docId, index);
        return meta;
      });
      this.metaPending.set(key, p);
    }
    return p;
  }

  /** Meta of the page, or of page 1 as an estimate until it's known. */
  private metaOrEstimate(ref: PageRef): PageMeta | undefined {
    const list = this.meta.get(ref.docId!);
    return list?.[ref.srcIndex] ?? list?.[0];
  }

  /** User-space view box (blank pages: 0,0,w,h). */
  viewBox(ref: PageRef): number[] {
    if (!ref.docId) return [0, 0, ref.blank!.width, ref.blank!.height];
    if (ref.crop) return ref.crop; // a piece made by "Cut pages"
    return this.metaOrEstimate(ref)?.view ?? [0, 0, 612, 792];
  }

  /** Total rotation = intrinsic /Rotate + user rotation. */
  rotation(ref: PageRef): number {
    if (!ref.docId) return ref.rotation;
    return ((this.metaOrEstimate(ref)?.rotate ?? 0) + ref.rotation) % 360;
  }

  /** Displayed size at zoom 1 in CSS px (1pt = 1px * 96/72). */
  displaySize(ref: PageRef): Size {
    const v = this.viewBox(ref);
    const w = (v[2] - v[0]) * CSS_UNITS;
    const h = (v[3] - v[1]) * CSS_UNITS;
    return this.rotation(ref) % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
  }

  /**
   * Background scan of page sizes, in small batches during idle time, so
   * mixed-size documents lay out exactly without blocking first paint.
   */
  scanSizes(docId: DocId): void {
    const token = ++this.scanToken;
    const d = this.docs.get(docId);
    if (!d) return;
    let i = 0;
    const step = async () => {
      if (token !== this.scanToken) return;
      const end = Math.min(d.numPages, i + 16);
      const batch: Promise<unknown>[] = [];
      for (; i < end; i++) batch.push(this.loadMeta(docId, i));
      await Promise.all(batch).catch(() => {});
      if (i < d.numPages) idle(step);
    };
    idle(step);
  }
}

/**
 * Open a PDF just to read it (folder search): streamed by byte range like the
 * viewer, never prompts. A password-protected file fails with an error named
 * "PasswordException"; an unreadable one fails after a few retries.
 */
export async function openForReading(source: PdfSource): Promise<{ pdf: PDFDocumentProxy; close(): Promise<void> }> {
  const transport = new SourceRangeTransport(source);
  const task = getDocument({
    range: transport,
    length: source.size,
    rangeChunkSize: 256 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    ...pdfjsAssets,
  } as Parameters<typeof getDocument>[0]);
  let locked = false;
  transport.onReadProblem = (err, failures) => {
    if (err && failures >= 3) {
      transport.abort();
      void task.destroy();
    }
  };
  task.onPassword = () => {
    locked = true;
    void task.destroy();
  };
  try {
    const pdf = await task.promise;
    return {
      pdf,
      close: async () => {
        transport.abort();
        await task.destroy();
      },
    };
  } catch (e) {
    transport.abort();
    if (locked) throw Object.assign(new Error("password protected"), { name: "PasswordException" });
    throw e;
  }
}

/**
 * A viewport that shows only `viewBox` of the page (a cut piece, or the
 * whole page). PDF.js can't take a custom view box, so the full page
 * viewport is shifted and the caller sizes the canvas to `width` x `height`.
 */
export function cropViewport(
  page: PDFPageProxy,
  viewBox: number[],
  scale: number,
  rotation: number,
): { viewport: ReturnType<PDFPageProxy["getViewport"]>; width: number; height: number } {
  const full = page.getViewport({ scale, rotation });
  const [ax, ay] = full.convertToViewportPoint(viewBox[0], viewBox[1]) as number[];
  const [bx, by] = full.convertToViewportPoint(viewBox[2], viewBox[3]) as number[];
  const minX = Math.min(ax, bx),
    minY = Math.min(ay, by);
  const width = Math.abs(bx - ax),
    height = Math.abs(by - ay);
  if (Math.abs(minX) < 0.01 && Math.abs(minY) < 0.01 && Math.abs(width - full.width) < 0.01 && Math.abs(height - full.height) < 0.01) {
    return { viewport: full, width: full.width, height: full.height };
  }
  return { viewport: page.getViewport({ scale, rotation, offsetX: -minX, offsetY: -minY }), width, height };
}

/** PDF points -> CSS px at 100% zoom (matches Acrobat/Chrome "actual size"). */
export const CSS_UNITS = 96 / 72;

export function idle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 500 });
  else setTimeout(fn, 16);
}
