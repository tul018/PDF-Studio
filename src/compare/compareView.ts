import { cropViewport, DocumentStore } from "../core/documents";
import type { DeviceProfile } from "../core/deviceProfile";
import type { PdfSource } from "../core/source";
import { pagesForDoc, type PageRef } from "../edit/model";
import { extractPageText, rectsFor, type PageText } from "../viewer/search";
import { Viewer, type Decorator, type Slot } from "../viewer/viewer";
import { diffWords, words } from "./diff";

/**
 * Split view, pane B showing ANOTHER PDF: the two documents side by side,
 * scrolling together (optional), with differences marked word by word -
 * red on the left for text removed or changed, green on the right for text
 * added. Pages without text (scans) are compared as pictures. The other PDF
 * is read-only here and uses its own document store.
 */
type Rects = number[][]; // user-space [x, y, w, h]

class DiffMarks implements Decorator {
  rects = new Map<number, Rects>();
  enabled = true;
  constructor(private cls: string) {}

  decorate(slot: Slot): void {
    slot.layers.querySelector(`:scope > .${this.cls}`)?.remove();
    const rs = this.enabled ? this.rects.get(slot.index) : undefined;
    if (!rs?.length) return;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", `diff-marks ${this.cls}`);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `matrix(${slot.view.transform.join(" ")})`);
    for (const [x, y, w, h] of rs) {
      const r = document.createElementNS(NS, "rect");
      Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => r.setAttribute(k, String(v)));
      g.appendChild(r);
    }
    svg.appendChild(g);
    slot.layers.appendChild(svg);
  }

  undecorate(slot: Slot): void {
    slot.layers.querySelector(`:scope > .${this.cls}`)?.remove();
  }
}

export interface CompareHost {
  store: DocumentStore;
  profile: DeviceProfile;
  /** Pane A's viewer and pages (the open, editable document). */
  leftViewer(): Viewer;
  leftPages(): readonly PageRef[];
  askPassword(name: string): (reason: "need" | "incorrect") => Promise<string | null>;
}

export class CompareView {
  private store = new DocumentStore();
  private viewer: Viewer | null = null;
  private scroller: HTMLDivElement | null = null;
  private pages: PageRef[] = [];
  private left = new DiffMarks("diff-del");
  private right = new DiffMarks("diff-add");
  private changed: number[] = [];
  private sync = true;
  private syncing = false;
  private token = 0;
  private offScroll: (() => void) | null = null;
  private bar: HTMLDivElement | null = null;

  constructor(
    private host: CompareHost,
    /** Pane B's root, header and own (same-document) scroller. */
    private root: HTMLElement,
    private head: HTMLElement,
    private ownScroller: HTMLElement,
  ) {}

  /** Called when the other PDF's page or zoom changes (pane header). */
  onChange: () => void = () => {};

  /** The other PDF's viewer while comparing. */
  get shown(): Viewer | null {
    return this.viewer;
  }

  get active(): boolean {
    return !!this.viewer;
  }

  async open(source: PdfSource): Promise<void> {
    this.close();
    const doc = await this.store.open(source, this.host.askPassword(source.name));
    this.pages = pagesForDoc(doc.id, doc.numPages);
    const scroller = document.createElement("div");
    scroller.className = "viewer compare-viewer";
    scroller.tabIndex = 0;
    this.ownScroller.hidden = true;
    this.root.appendChild(scroller);
    this.scroller = scroller;
    const viewer = new Viewer(scroller, this.store, this.host.profile);
    viewer.budgetShare = 0.5;
    viewer.addDecorator(this.right);
    viewer.setPages(this.pages, false);
    viewer.onZoomChange = () => this.onChange();
    viewer.onPageChange = () => this.onChange();
    this.viewer = viewer;
    this.host.leftViewer().addDecorator(this.left);
    requestAnimationFrame(() => viewer.setFit("width"));
    this.buildBar(source.name);
    this.bindSync();
    void this.computeAll();
  }

  close(): void {
    this.token++;
    this.offScroll?.();
    this.offScroll = null;
    if (this.viewer) {
      this.host.leftViewer().removeDecorator(this.left);
      this.viewer.destroy();
      this.viewer = null;
    }
    this.scroller?.remove();
    this.scroller = null;
    this.bar?.remove();
    this.bar = null;
    this.ownScroller.hidden = false;
    this.left.rects.clear();
    this.right.rects.clear();
    this.changed = [];
    void this.store.closeAll();
    this.root.classList.remove("comparing");
    this.onChange();
  }

  private buildBar(name: string): void {
    this.root.classList.add("comparing");
    const bar = document.createElement("div");
    bar.className = "compare-bar";
    const title = document.createElement("span");
    title.className = "compare-name";
    title.textContent = name;
    title.title = name;
    const sync = document.createElement("label");
    sync.className = "check small";
    const syncBox = Object.assign(document.createElement("input"), { type: "checkbox", checked: this.sync });
    sync.append(syncBox, " Sync scrolling");
    syncBox.addEventListener("change", () => {
      this.sync = syncBox.checked;
      if (this.sync) this.follow(this.host.leftViewer(), this.viewer!);
    });
    const diff = document.createElement("label");
    diff.className = "check small";
    const diffBox = Object.assign(document.createElement("input"), { type: "checkbox", checked: true });
    diff.append(diffBox, " Show differences");
    diffBox.addEventListener("change", () => {
      this.left.enabled = this.right.enabled = diffBox.checked;
      this.redecorate();
    });
    const status = document.createElement("span");
    status.className = "compare-status muted small";
    const btn = (label: string, tip: string, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = label;
      b.title = tip;
      b.addEventListener("click", fn);
      return b;
    };
    bar.append(
      title,
      sync,
      diff,
      status,
      btn("‹", "Previous difference", () => this.step(-1)),
      btn("›", "Next difference", () => this.step(1)),
      btn("Back", "Show your own PDF in this pane again", () => this.close()),
    );
    this.head.after(bar);
    this.bar = bar;
  }

  private status(text: string): void {
    const s = this.bar?.querySelector(".compare-status");
    if (s) s.textContent = text;
  }

  /** Scroll the other side to the same page and place, whichever side moves. */
  private bindSync(): void {
    const a = this.host.leftViewer(),
      b = this.viewer!;
    const onA = () => this.sync && this.follow(a, b);
    const onB = () => this.sync && this.follow(b, a);
    a.scroller.addEventListener("scroll", onA, { passive: true });
    b.scroller.addEventListener("scroll", onB, { passive: true });
    this.offScroll = () => {
      a.scroller.removeEventListener("scroll", onA);
      b.scroller.removeEventListener("scroll", onB);
    };
  }

  private follow(from: Viewer, to: Viewer): void {
    if (this.syncing) return;
    this.syncing = true;
    const p = from.position();
    to.scrollToPosition(Math.min(p.index, to.pageList.length - 1), p.fy);
    requestAnimationFrame(() => (this.syncing = false));
  }

  private step(dir: 1 | -1): void {
    if (!this.changed.length) return;
    const cur = this.host.leftViewer().currentIndex;
    const next = dir > 0 ? (this.changed.find((i) => i > cur) ?? this.changed[0]) : ([...this.changed].reverse().find((i) => i < cur) ?? this.changed[this.changed.length - 1]);
    this.host.leftViewer().scrollToPage(next);
    this.viewer?.scrollToPage(Math.min(next, this.pages.length - 1));
  }

  private redecorate(): void {
    this.host.leftViewer().redecorate();
    this.viewer?.redecorate();
  }

  /** Compare page by page in the background; marks appear as pages are done. */
  private async computeAll(): Promise<void> {
    const token = this.token;
    const total = Math.max(this.host.leftPages().length, this.pages.length);
    for (let i = 0; i < total; i++) {
      if (token !== this.token) return;
      this.status(`Comparing… ${i + 1} / ${total}`);
      try {
        if (await this.comparePage(i)) this.changed.push(i);
      } catch {
        /* a page that can't be read is skipped */
      }
      if (i % 4 === 3) this.redecorate();
      await new Promise((r) => setTimeout(r, 0)); // keep scrolling smooth
    }
    if (token !== this.token) return;
    this.redecorate();
    this.status(this.changed.length ? `${this.changed.length} of ${total} pages differ` : "No differences found");
  }

  private async comparePage(i: number): Promise<boolean> {
    const refA = this.host.leftPages()[i],
      refB = this.pages[i];
    if (!refA || !refB) {
      // A page only one side has: mark it whole.
      const ref = refA ?? refB;
      const store = refA ? this.host.store : this.store;
      const [x0, y0, x1, y1] = store.viewBox(ref!);
      (refA ? this.left : this.right).rects.set(i, [[x0, y0, x1 - x0, y1 - y0]]);
      return true;
    }
    const [pa, pb] = await Promise.all([this.host.store.getPage(refA), this.store.getPage(refB)]);
    if (!pa || !pb) return false;
    const [ta, tb] = await Promise.all([extractPageText(pa), extractPageText(pb)]);
    if (ta.text.trim().length > 10 || tb.text.trim().length > 10) {
      const { removed, added } = diffWords(words(ta.text), words(tb.text));
      const toRects = (pt: PageText, ws: { start: number; end: number }[]) => ws.flatMap((w) => rectsFor(pt, w.start, w.end));
      if (removed.length) this.left.rects.set(i, toRects(ta, removed));
      if (added.length) this.right.rects.set(i, toRects(tb, added));
      return removed.length + added.length > 0;
    }
    // Scans: compare as pictures, box the changed areas on both sides.
    const boxes = await pictureDiff(pa, this.host.store.viewBox(refA), pb, this.store.viewBox(refB));
    if (!boxes.a.length) return false;
    this.left.rects.set(i, boxes.a);
    this.right.rects.set(i, boxes.b);
    return true;
  }
}

/** Changed areas of two page pictures (16 px cells at 300 px wide), in each page's user space. */
async function pictureDiff(
  pa: Parameters<typeof cropViewport>[0],
  boxA: number[],
  pb: Parameters<typeof cropViewport>[0],
  boxB: number[],
): Promise<{ a: Rects; b: Rects }> {
  const W = 300;
  const draw = async (page: typeof pa, box: number[]) => {
    const base = cropViewport(page, box, 1, 0);
    const c = cropViewport(page, box, W / base.width, 0);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = Math.round(c.height);
    await page.render({ canvas, viewport: c.viewport, background: "white" } as Parameters<typeof page.render>[0]).promise;
    return canvas;
  };
  const [ca, cb] = await Promise.all([draw(pa, boxA), draw(pb, boxB)]);
  const h = Math.min(ca.height, cb.height);
  const da = ca.getContext("2d")!.getImageData(0, 0, W, h).data;
  const db = cb.getContext("2d")!.getImageData(0, 0, W, h).data;
  const CELL = 16;
  const a: Rects = [],
    b: Rects = [];
  const toUser = (box: number[], x: number, y: number, w: number, hh: number) => {
    const sx = (box[2] - box[0]) / W,
      sy = (box[3] - box[1]) / (W * ((box[3] - box[1]) / (box[2] - box[0])));
    return [box[0] + x * sx, box[3] - (y + hh) * sy, w * sx, hh * sy];
  };
  for (let y = 0; y < h; y += CELL) {
    for (let x = 0; x < W; x += CELL) {
      let diff = 0,
        n = 0;
      for (let yy = y; yy < Math.min(h, y + CELL); yy += 2) {
        for (let xx = x; xx < Math.min(W, x + CELL); xx += 2) {
          const k = (yy * W + xx) * 4;
          diff += Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]);
          n++;
        }
      }
      if (diff / Math.max(1, n) > 60) {
        a.push(toUser(boxA, x, y, CELL, CELL));
        b.push(toUser(boxB, x, y, CELL, CELL));
      }
    }
  }
  ca.width = ca.height = cb.width = cb.height = 0;
  return { a, b };
}
