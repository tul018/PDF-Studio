import type { PDFDocumentProxy } from "pdfjs-dist";
import { fileKeyOf, fileVersionOf, type PdfSource } from "../core/source";
import { extractPageText, normalizeQuery } from "./search";

/**
 * Search every PDF in a folder (e.g. all supplier catalogs) for a word or
 * part number. Each file's text is extracted once and remembered (keyed by
 * file + version), so repeat searches - even after a restart - don't reopen
 * the PDFs at all. Files are read 1-3 at a time, each in its own PDF.js
 * worker thread: fast, without taking over the PC.
 */
export interface FolderHit {
  pageIndex: number;
  /** Matches on this page. */
  count: number;
  before: string;
  match: string;
  after: string;
}

export interface FolderFileResult {
  source: PdfSource;
  hits: FolderHit[];
}

export interface FolderSearchState {
  results: FolderFileResult[];
  scanned: number;
  total: number;
  /** Files with no text at all (scans / photos: need OCR). */
  noText: string[];
  /** Password-protected files. */
  locked: string[];
  failed: string[];
  done: boolean;
}

/** Remembered page texts per file version. */
export interface TextIndex {
  get(key: string): Promise<string[] | undefined>;
  put(key: string, pages: string[]): Promise<void>;
}

export interface OpenedPdf {
  pdf: PDFDocumentProxy;
  close(): Promise<void>;
}

export interface FolderSearchDeps {
  /** Open a PDF for reading (throws an error named "PasswordException" when locked). */
  open(source: PdfSource): Promise<OpenedPdf>;
  index: TextIndex;
  /** Files read at the same time. */
  parallel?: number;
}

const SNIPPET = 48;
const MAX_HITS_PER_FILE = 200;

export class FolderSearch {
  onUpdate: (s: FolderSearchState) => void = () => {};
  private token = 0;
  /** Texts used recently, so typing a new query doesn't even touch the index. */
  private memory = new Map<string, string[]>();
  private memoryChars = 0;

  constructor(private deps: FolderSearchDeps) {}

  cancel(): void {
    this.token++;
  }

  async run(sources: readonly PdfSource[], query: string, caseSensitive = false): Promise<FolderSearchState> {
    const token = ++this.token;
    const q = normalizeQuery(query, caseSensitive);
    const state: FolderSearchState = { results: [], scanned: 0, total: sources.length, noText: [], locked: [], failed: [], done: false };
    if (!q.trim()) {
      state.done = true;
      this.onUpdate(state);
      return state;
    }
    const found: (FolderFileResult | undefined)[] = new Array(sources.length);
    let next = 0;
    let lastEmit = 0;
    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 150) return;
      lastEmit = now;
      state.results = found.filter((r): r is FolderFileResult => !!r);
      this.onUpdate({ ...state });
    };
    const worker = async () => {
      while (next < sources.length && token === this.token) {
        const i = next++;
        const source = sources[i];
        try {
          const pages = await this.texts(source, () => token !== this.token);
          if (token !== this.token) return;
          if (!pages) continue;
          if (pages.every((t) => !t.trim())) state.noText.push(source.name);
          const hits = findIn(pages, q, caseSensitive);
          if (hits.length) found[i] = { source, hits };
        } catch (e) {
          if (token !== this.token) return;
          if ((e as Error)?.name === "PasswordException") state.locked.push(source.name);
          else state.failed.push(source.name);
        } finally {
          state.scanned++;
          emit();
        }
      }
    };
    const n = Math.max(1, Math.min(this.deps.parallel ?? 2, sources.length));
    await Promise.all(Array.from({ length: n }, worker));
    if (token !== this.token) return state;
    state.done = true;
    emit(true);
    return { ...state, results: found.filter((r): r is FolderFileResult => !!r) };
  }

  /** Page texts of a file: from memory, the index, or by reading the PDF once. */
  private async texts(source: PdfSource, cancelled: () => boolean): Promise<string[] | null> {
    const key = `${fileKeyOf(source)}|${fileVersionOf(source)}`;
    const mem = this.memory.get(key);
    if (mem) return mem;
    let pages = await this.deps.index.get(key);
    if (!pages) {
      const opened = await this.deps.open(source);
      try {
        pages = [];
        const { pdf } = opened;
        // A few pages ahead, so the worker never waits on a round trip.
        const ahead = new Map<number, Promise<string>>();
        const want = (p: number) => {
          if (p > pdf.numPages || ahead.has(p)) return;
          ahead.set(
            p,
            pdf.getPage(p).then(async (page) => {
              const t = (await extractPageText(page)).text;
              page.cleanup();
              return t;
            }),
          );
        };
        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled()) return null;
          for (let k = p; k <= p + 3; k++) want(k);
          pages.push(await ahead.get(p)!.catch(() => ""));
          ahead.delete(p);
        }
      } finally {
        await opened.close();
      }
      await this.deps.index.put(key, pages).catch(() => {});
    }
    this.remember(key, pages);
    return pages;
  }

  private remember(key: string, pages: string[]): void {
    const chars = pages.reduce((n, t) => n + t.length, 0);
    this.memory.set(key, pages);
    this.memoryChars += chars;
    // Keep ~32 M characters (64 MB) of recently used text.
    for (const [k, v] of this.memory) {
      if (this.memoryChars <= 32_000_000 || k === key) break;
      this.memory.delete(k);
      this.memoryChars -= v.reduce((n, t) => n + t.length, 0);
    }
  }
}

/** Matches of q in each page, with a line of context around the first one. */
export function findIn(pages: readonly string[], q: string, caseSensitive = false): FolderHit[] {
  const hits: FolderHit[] = [];
  let total = 0;
  for (let p = 0; p < pages.length && total < MAX_HITS_PER_FILE; p++) {
    const text = pages[p];
    const hay = caseSensitive ? text : text.toLowerCase();
    let at = hay.indexOf(q);
    if (at < 0) continue;
    const first = at;
    let count = 0;
    while (at >= 0) {
      count++;
      at = hay.indexOf(q, at + Math.max(1, q.length));
    }
    total += count;
    const line = (s: string) => s.replace(/\s+/g, " ");
    hits.push({
      pageIndex: p,
      count,
      // Cut mid-text: drop the partial first word and show "…".
      before: first > SNIPPET ? "…" + line(text.slice(first - SNIPPET, first)).replace(/^\S*\s(?=\S)/, "") : line(text.slice(0, first)),
      match: text.slice(first, first + q.length),
      after: line(text.slice(first + q.length, first + q.length + SNIPPET)),
    });
  }
  return hits;
}
