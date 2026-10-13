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
}

export type PasswordPrompt = (reason: "need" | "incorrect") => Promise<string | null>;

/**
 * Owns every open PDFDocumentProxy (the main file plus any merged files) and
 * caches lightweight page metadata so the virtual layout can be computed
 * without parsing pages.
 */
export class DocumentStore {
  readonly docs = new Map<DocId, LoadedDoc>();
  private meta = new Map<string, PageMeta>();
  private metaPending = new Map<string, Promise<PageMeta>>();
  private sizeListeners = new Set<(docId: DocId, index: number) => void>();
  private scanToken = 0;

  async open(source: PdfSource, askPassword: PasswordPrompt, onProgress?: (f: number) => void): Promise<LoadedDoc> {
    const transport = new SourceRangeTransport(source);
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
      enableXfa: false,
      useSystemFonts: true,
    } as Parameters<typeof getDocument>[0]);
    let encrypted = false;
    task.onPassword = (update: (pw: string) => void, reason: number) => {
      encrypted = true;
      askPassword(reason === PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "need").then((pw) => {
        if (pw === null) task.destroy();
        else update(pw);
      });
    };
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (onProgress && total) onProgress(Math.min(1, loaded / total));
    };
    const pdf = await task.promise;
    if (!encrypted) {
      try {
        // Encrypted-but-no-password files (permissions only) still load.
        const md = await pdf.getMetadata();
        encrypted = Boolean((md.info as Record<string, unknown>)?.EncryptFilterName);
      } catch {
        /* ignore */
      }
    }
    const doc: LoadedDoc = { id: uid("doc"), source, pdf, task, numPages: pdf.numPages, encrypted };
    this.docs.set(doc.id, doc);
    await this.loadMeta(doc.id, 0); // first page = size estimate for the rest
    return doc;
  }

  async closeAll(): Promise<void> {
    this.scanToken++;
    const docs = [...this.docs.values()];
    this.docs.clear();
    this.meta.clear();
    this.metaPending.clear();
    await Promise.all(docs.map((d) => d.task.destroy().catch(() => {})));
  }

  onSize(fn: (docId: DocId, index: number) => void): () => void {
    this.sizeListeners.add(fn);
    return () => this.sizeListeners.delete(fn);
  }

  getPage(ref: PageRef): Promise<PDFPageProxy> | null {
    if (!ref.docId) return null;
    const d = this.docs.get(ref.docId);
    if (!d) return null;
    return d.pdf.getPage(ref.srcIndex + 1);
  }

  metaOf(ref: PageRef): PageMeta | undefined {
    if (!ref.docId) return undefined;
    return this.meta.get(`${ref.docId}:${ref.srcIndex}`);
  }

  loadMeta(docId: DocId, index: number): Promise<PageMeta> {
    const key = `${docId}:${index}`;
    const m = this.meta.get(key);
    if (m) return Promise.resolve(m);
    let p = this.metaPending.get(key);
    if (!p) {
      const d = this.docs.get(docId)!;
      p = d.pdf.getPage(index + 1).then((page) => {
        const meta = { view: page.view.slice(), rotate: page.rotate };
        this.meta.set(key, meta);
        this.metaPending.delete(key);
        for (const fn of this.sizeListeners) fn(docId, index);
        return meta;
      });
      this.metaPending.set(key, p);
    }
    return p;
  }

  /** User-space view box (blank pages: 0,0,w,h). */
  viewBox(ref: PageRef): number[] {
    if (!ref.docId) return [0, 0, ref.blank!.width, ref.blank!.height];
    const m = this.metaOf(ref) ?? this.meta.get(`${ref.docId}:0`);
    return m ? m.view : [0, 0, 612, 792];
  }

  /** Total rotation = intrinsic /Rotate + user rotation. */
  rotation(ref: PageRef): number {
    if (!ref.docId) return ref.rotation;
    const m = this.metaOf(ref) ?? this.meta.get(`${ref.docId}:0`);
    return ((m?.rotate ?? 0) + ref.rotation) % 360;
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

/** PDF points -> CSS px at 100% zoom (matches Acrobat/Chrome "actual size"). */
export const CSS_UNITS = 96 / 72;

export function idle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 500 });
  else setTimeout(fn, 16);
}
