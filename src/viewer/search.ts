import type { DocumentStore } from "../core/documents";
import { WeightedLRU } from "../core/lru";
import type { PageRef } from "../edit/model";

interface PageText {
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
export class Search {
  private cache = new WeightedLRU<PageText>(24 * 1024 * 1024);
  private token = 0;
  hits: SearchHit[] = [];
  currentHit = -1;
  query = "";
  onUpdate: (done: boolean, scanned: number, total: number) => void = () => {};

  constructor(private store: DocumentStore) {}

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
    for (let k = 0; k < n; k++) {
      const i = (startIndex + k) % n;
      const ref = pages[i];
      if (!ref.docId) continue;
      const pt = await this.pageText(ref).catch(() => null);
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
        if (pageHits.length) {
          found[i] = pageHits;
          this.hits = found.flat();
          if (this.currentHit < 0) this.currentHit = this.hits.findIndex((h) => h.pageIndex >= startIndex);
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
    const tc = await page.getTextContent();
    let text = "";
    const items: number[] = [];
    let count = 0;
    for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }>) {
      if (typeof it.str !== "string" || !it.transform) continue;
      const s = normalize(it.str);
      const [a, b, , , e, f] = it.transform;
      items.push(text.length, s.length, e, f, it.width ?? 0, it.height || Math.hypot(a, b) || 10, a, b);
      text += s;
      count++;
      text += it.hasEOL ? "\n" : s.endsWith(" ") ? "" : " ";
    }
    const pt: PageText = { text, items: new Float64Array(items), count };
    this.cache.set(key, pt, text.length * 2 + items.length * 8);
    page.cleanup();
    return pt;
  }
}

function normalize(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ");
}

/** Approximate rectangles (user space) covering text[start, end). */
function rectsFor(pt: PageText, start: number, end: number): number[][] {
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
