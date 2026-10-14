import type { PDFPageProxy } from "pdfjs-dist";
import type { DocumentStore } from "../core/documents";
import { WeightedLRU } from "../core/lru";
import type { PageRef } from "../edit/model";

export interface PageText {
  text: string;
  /** For each item: [start offset in text, length, x, y, width, height, a, b] */
  items: Float64Array;
  count: number;
}

export interface SearchHit {
  pageId: string;
  pageIndex: number;
  rects: number[][]; // user space [x, y, w, h]
}

/**
 * Incremental, cancellable full-text search. Pages are processed one at a
 * time starting at the current page; results stream in while you keep
 * scrolling. Extracted text is kept in a size-bounded LRU, so searching a
 * 10 000-page file doesn't hold the whole text in memory forever.
 */
/** Extracted page text, shared by every Search (each split pane has its own). */
export type TextCache = WeightedLRU<PageText>;
export const newTextCache = (): TextCache => new WeightedLRU<PageText>(24 * 1024 * 1024);

export class Search {
  private token = 0;
  hits: SearchHit[] = [];
  currentHit = -1;
  query = "";
  onUpdate: (done: boolean, scanned: number, total: number) => void = () => {};

  constructor(
    private store: DocumentStore,
    private cache: TextCache = newTextCache(),
  ) {}

  clear(): void {
    this.token++;
    this.hits = [];
    this.currentHit = -1;
    this.query = "";
  }

  invalidate(): void {
    this.cache.clear();
  }

  hitsFor(pageId: string): { rects: number[][]; current: boolean }[] {
    const out: { rects: number[][]; current: boolean }[] = [];
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i];
      if (h.pageId === pageId) out.push({ rects: h.rects, current: i === this.currentHit });
    }
    return out;
  }

  async run(query: string, pages: readonly PageRef[], startIndex: number, caseSensitive = false): Promise<void> {
    const token = ++this.token;
    this.hits = [];
    this.currentHit = -1;
    this.query = query;
    const q = normalize(caseSensitive ? query : query.toLowerCase());
    if (!q.trim()) {
      this.onUpdate(true, 0, 0);
      return;
    }
    const n = pages.length;
    const found: SearchHit[][] = new Array(n);
    let scanned = 0;
    let lastEmit = performance.now();
    // Ask for a few pages ahead, so the PDF worker always has the next page
    // queued instead of idling for a round trip after each one.
    const AHEAD = 4;
    const ahead = new Map<number, Promise<PageText | null>>();
    const prefetch = (k: number) => {
      if (k >= n || ahead.has(k)) return;
      const ref = pages[(startIndex + k) % n];
      ahead.set(k, ref.docId ? this.pageText(ref).catch(() => null) : Promise.resolve(null));
    };
    for (let k = 0; k < n; k++) {
      const i = (startIndex + k) % n;
      const ref = pages[i];
      for (let j = k; j <= k + AHEAD; j++) prefetch(j);
      const pending = ahead.get(k)!;
      ahead.delete(k);
      if (!ref.docId) continue;
      const pt = await pending;
      if (token !== this.token) return;
      scanned++;
      if (pt) {
        const hay = caseSensitive ? pt.text : pt.text.toLowerCase();
        const pageHits: SearchHit[] = [];
        let from = 0;
        for (;;) {
          const at = hay.indexOf(q, from);
          if (at < 0) break;
          pageHits.push({ pageId: ref.id, pageIndex: i, rects: rectsFor(pt, at, at + q.length) });
          from = at + Math.max(1, q.length);
        }
        // A cut piece only shows part of the page: drop hits outside it.
        if (ref.crop) {
          const [cx0, cy0, cx1, cy1] = ref.crop;
          const shown = (r: number[]) => r[0] + r[2] > cx0 && r[0] < cx1 && r[1] + r[3] > cy0 && r[1] < cy1;
          for (let k = pageHits.length - 1; k >= 0; k--) if (!pageHits[k].rects.some(shown)) pageHits.splice(k, 1);
        }
        if (pageHits.length) {
          // Keep the current hit on the same match while earlier pages' hits
          // are inserted before it (the search wraps around from startIndex).
          const current = this.hits[this.currentHit];
          found[i] = pageHits;
          this.hits = found.flat();
          this.currentHit = current ? this.hits.indexOf(current) : this.hits.findIndex((h) => h.pageIndex >= startIndex);
        }
      }
      if (performance.now() - lastEmit > 120) {
        lastEmit = performance.now();
        this.onUpdate(false, scanned, n);
        // Yield so scrolling/rendering stays smooth during long searches.
        await new Promise((r) => setTimeout(r, 0));
        if (token !== this.token) return;
      }
    }
    if (this.currentHit < 0 && this.hits.length) this.currentHit = 0;
    this.onUpdate(true, scanned, n);
  }

  step(dir: 1 | -1): SearchHit | null {
    if (!this.hits.length) return null;
    this.currentHit = (this.currentHit + dir + this.hits.length) % this.hits.length;
    return this.hits[this.currentHit];
  }

  private async pageText(ref: PageRef): Promise<PageText | null> {
    const key = `${ref.docId}:${ref.srcIndex}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const page = await this.store.getPage(ref);
    if (!page) return null;
    const pt = await extractPageText(page);
    this.cache.set(key, pt, pt.text.length * 2 + pt.items.length * 8);
    page.cleanup();
    return pt;
  }
}

/**
 * A page's text as one searchable string (plus item positions for
 * highlighting). Shared by in-document search and folder search, so both
 * match exactly the same way.
 */
export async function extractPageText(page: PDFPageProxy): Promise<PageText> {
  // normalize() below already does NFKC; skip the worker's own pass.
  const tc = await page.getTextContent({ disableNormalization: true });
  let text = "";
  const items: number[] = [];
  let count = 0;
  let sep = "";
  for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }>) {
    if (typeof it.str !== "string" || !it.transform) continue;
    const s = normalize(it.str);
    if (!s) {
      if (it.hasEOL) sep = "\n";
      continue;
    }
    // Thai, Chinese and Japanese don't put spaces between words: PDFs often
    // split such text into many pieces (and lines), and a separator there
    // would make "你好" or a Thai word unfindable.
    // PDF.js can emit spaces as separate items (notably OCR text layers).
    // Only synthesize a separator when neither adjacent item supplies one.
    if (sep && !text.endsWith(" ") && !s.startsWith(" ") && !(NO_SPACE_SCRIPT.test(text.slice(-1)) && NO_SPACE_SCRIPT.test(s[0]))) text += " ";
    const [a, b, , , e, f] = it.transform;
    items.push(text.length, s.length, e, f, it.width ?? 0, it.height || Math.hypot(a, b) || 10, a, b);
    text += s;
    count++;
    sep = it.hasEOL ? "\n" : s.endsWith(" ") ? "" : " ";
  }
  return { text, items: new Float64Array(items), count };
}

/** Query normalized the same way as page text. */
export function normalizeQuery(q: string, caseSensitive = false): string {
  return normalize(caseSensitive ? q : q.toLowerCase());
}

/** Scripts written without spaces between words: Thai, Lao, Khmer, Myanmar, CJK, kana, full-width forms. */
const NO_SPACE_SCRIPT = /[฀-໿က-႟ក-៿　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

function normalize(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ");
}

/** Approximate rectangles (user space) covering text[start, end). */
export function rectsFor(pt: PageText, start: number, end: number): number[][] {
  const out: number[][] = [];
  const it = pt.items;
  for (let k = 0; k < pt.count; k++) {
    const o = k * 8;
    const s0 = it[o],
      len = Math.max(1, it[o + 1]),
      s1 = s0 + len;
    if (s1 <= start || s0 >= end) continue;
    const x = it[o + 2],
      y = it[o + 3],
      w = it[o + 4],
      h = it[o + 5];
    const a = it[o + 6],
      b = it[o + 7];
    const c0 = Math.max(0, start - s0),
      c1 = Math.min(len, end - s0);
    const fx0 = c0 / len,
      fx1 = c1 / len;
    if (Math.abs(b) < 1e-3) {
      const dir = a < 0 ? -1 : 1;
      const left = x + dir * w * fx0;
      const right = x + dir * w * fx1;
      out.push([Math.min(left, right), y - h * 0.22, Math.abs(right - left), h * 1.12]);
    } else {
      // Rotated text: highlight the whole run's bounding box.
      const ang = Math.atan2(b, a);
      const ex = x + Math.cos(ang) * w,
        ey = y + Math.sin(ang) * w;
      const pad = h;
      out.push([Math.min(x, ex) - pad / 2, Math.min(y, ey) - pad / 2, Math.abs(ex - x) + pad, Math.abs(ey - y) + pad]);
    }
  }
  return out;
}
