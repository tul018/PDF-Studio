import { AnnotationMode, type PDFPageProxy } from "pdfjs-dist";
import { cropViewport, type DocumentStore } from "../core/documents";
import { PageLayout } from "../core/layout";
import { WeightedLRU } from "../core/lru";
import { isAbort, type RenderQueue } from "../core/renderQueue";
import type { PageRef } from "../edit/model";
import { freeCanvas } from "./viewer";

const THUMB_W = 116;
const LABEL_H = 22;

interface Item {
  ref: PageRef;
  index: number;
  el: HTMLDivElement;
  frame: HTMLDivElement;
}

/**
 * Virtualized thumbnail strip. Thumbnails are tiny (~0.05 Mpx) and live in a
 * pixel-budgeted LRU, so scrolling the sidebar of a 5 000-page file never
 * holds more than a few MB of bitmaps. They render at the lowest priority
 * so they never delay the main view.
 */
export class Thumbnails {
  private layout = new PageLayout();
  private inner: HTMLDivElement;
  private items = new Map<string, Item>();
  private pages: readonly PageRef[] = [];
  private cache: WeightedLRU<HTMLCanvasElement>;
  private raf = false;
  private dragIds: Set<string> | null = null;
  selected = new Set<string>();
  private lastClicked = -1;
  private currentId = "";
  onNavigate: (index: number) => void = () => {};
  onSelectionChange: (ids: Set<string>) => void = () => {};
  onMove: (ids: Set<string>, toIndex: number) => void = () => {};
  /** The page as already drawn in the main view, if it is (see render). */
  renderedPage: (ref: PageRef) => HTMLCanvasElement | undefined = () => undefined;
  /** The main view is about to draw this page: wait and copy it (call refresh() then). */
  mainWillDraw: (ref: PageRef) => boolean = () => false;

  refresh(): void {
    this.request();
  }

  /** Cached thumbnail of a page, if there is one (placeholder for the main view). */
  cached(ref: PageRef): HTMLCanvasElement | undefined {
    return this.cache.peek(this.cacheKey(ref));
  }

  constructor(
    private scroller: HTMLElement,
    private store: DocumentStore,
    private queue: RenderQueue,
    private dpr: number,
    budgetPixels: number,
  ) {
    this.inner = document.createElement("div");
    this.inner.className = "thumbs-inner";
    scroller.appendChild(this.inner);
    this.cache = new WeightedLRU(budgetPixels, (_k, c) => freeCanvas(c));
    scroller.addEventListener("scroll", () => this.request(), { passive: true });
    new ResizeObserver(() => this.request()).observe(scroller);
    store.onSize(() => {
      this.relayout();
      this.request();
    });
  }

  setPages(pages: readonly PageRef[]): void {
    this.pages = pages;
    const ids = new Set(pages.map((p) => p.id));
    for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);
    for (const [id, it] of [...this.items]) {
      const idx = pages.findIndex((p) => p.id === id);
      if (idx < 0 || pages[idx] !== it.ref) this.unmount(it);
    }
    this.relayout();
    this.request();
  }

  private relayout(): void {
    this.layout.setSizes(
      this.pages.map((p) => {
        const s = this.store.displaySize(p);
        return { width: THUMB_W, height: Math.round((THUMB_W * s.height) / s.width) + LABEL_H };
      }),
    );
    this.inner.style.height = `${this.layout.totalHeight()}px`;
    const byId = new Map(this.pages.map((p, i) => [p.id, i]));
    for (const it of this.items.values()) {
      it.index = byId.get(it.ref.id) ?? it.index;
      this.position(it);
    }
  }

  setCurrent(index: number): void {
    const id = this.pages[index]?.id ?? "";
    if (id === this.currentId) return;
    this.items.get(this.currentId)?.el.classList.remove("current");
    this.currentId = id;
    this.items.get(id)?.el.classList.add("current");
    // Keep the current thumbnail in view.
    if (index >= 0 && index < this.pages.length) {
      const top = this.layout.top(index);
      const h = this.layout.size(index).height;
      const st = this.scroller.scrollTop;
      if (top < st || top + h > st + this.scroller.clientHeight) {
        this.scroller.scrollTop = top - this.scroller.clientHeight / 3;
      }
    }
  }

  clearSelection(): void {
    this.selected.clear();
    for (const it of this.items.values()) it.el.classList.remove("selected");
    this.onSelectionChange(this.selected);
  }

  private request(): void {
    if (this.raf) return;
    this.raf = true;
    requestAnimationFrame(() => {
      this.raf = false;
      this.update();
    });
  }

  private update(): void {
    if (!this.pages.length || this.scroller.clientHeight === 0) {
      for (const it of [...this.items.values()]) this.unmount(it);
      return;
    }
    const top = this.scroller.scrollTop;
    const bottom = top + this.scroller.clientHeight;
    const [first, last] = this.layout.visibleRange(top - 200, bottom + 200);
    for (const it of [...this.items.values()]) if (it.index < first || it.index > last) this.unmount(it);
    for (let i = first; i <= last; i++) {
      const ref = this.pages[i];
      let it = this.items.get(ref.id);
      if (!it) it = this.mount(ref, i);
      const key = this.cacheKey(ref);
      if (!it.frame.querySelector("canvas")) {
        const cached = this.cache.get(key);
        if (cached) it.frame.appendChild(cached);
        else if (ref.docId && !this.mainWillDraw(ref)) {
          this.queue.schedule({
            key: `thumb:${ref.id}`,
            priority: 1e7 + Math.abs(i - first),
            run: (signal) => this.render(it!, signal),
          });
        }
      }
    }
    this.queue.retain((k) => !k.startsWith("thumb:") || this.items.has(k.slice(6)));
  }

  private cacheKey(ref: PageRef): string {
    return `${ref.id}:${ref.rotation}`;
  }

  private mount(ref: PageRef, index: number): Item {
    const el = document.createElement("div");
    el.className = "thumb";
    el.draggable = true;
    el.dataset.pageId = ref.id;
    const frame = document.createElement("div");
    frame.className = "thumb-frame";
    if (!ref.docId) frame.classList.add("blank");
    const label = document.createElement("div");
    label.className = "thumb-label";
    el.append(frame, label);
    const it: Item = { ref, index, el, frame };
    el.addEventListener("click", (e) => this.onClick(it, e));
    el.addEventListener("dragstart", (e) => {
      if (!this.selected.has(ref.id)) {
        this.selected = new Set([ref.id]);
        this.syncSelectionClasses();
      }
      this.dragIds = new Set(this.selected);
      e.dataTransfer?.setData("text/plain", "pages");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragover", (e) => {
      if (!this.dragIds) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      el.classList.toggle("drop-before", !after);
      el.classList.toggle("drop-after", after);
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drop-before", "drop-after");
      if (!this.dragIds) return;
      const r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      // Target index in the list *without* the moved pages.
      let target = 0;
      for (let i = 0; i < this.pages.length; i++) {
        if (this.pages[i].id === ref.id) break;
        if (!this.dragIds.has(this.pages[i].id)) target++;
      }
      if (after && !this.dragIds.has(ref.id)) target++;
      this.onMove(this.dragIds, target);
      this.dragIds = null;
    });
    el.addEventListener("dragend", () => (this.dragIds = null));
    this.items.set(ref.id, it);
    this.position(it);
    if (this.selected.has(ref.id)) el.classList.add("selected");
    if (ref.id === this.currentId) el.classList.add("current");
    this.inner.appendChild(el);
    return it;
  }

  private position(it: Item): void {
    const s = this.layout.size(it.index);
    it.el.style.top = `${this.layout.top(it.index)}px`;
    it.frame.style.height = `${s.height - LABEL_H}px`;
    (it.el.lastChild as HTMLElement).textContent = String(it.index + 1);
  }

  private unmount(it: Item): void {
    this.queue.cancel(`thumb:${it.ref.id}`);
    // Canvas stays in the LRU (detached) for instant re-show.
    it.el.remove();
    this.items.delete(it.ref.id);
  }

  private onClick(it: Item, e: MouseEvent): void {
    const id = it.ref.id;
    if (e.shiftKey && this.lastClicked >= 0) {
      const [a, b] = [Math.min(this.lastClicked, it.index), Math.max(this.lastClicked, it.index)];
      for (let i = a; i <= b; i++) this.selected.add(this.pages[i].id);
    } else if (e.ctrlKey || e.metaKey) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    } else {
      this.selected = new Set([id]);
      this.onNavigate(it.index);
    }
    this.lastClicked = it.index;
    this.syncSelectionClasses();
    this.onSelectionChange(this.selected);
  }

  private syncSelectionClasses(): void {
    for (const it of this.items.values()) it.el.classList.toggle("selected", this.selected.has(it.ref.id));
  }

  private keep(it: Item, canvas: HTMLCanvasElement): void {
    const key = this.cacheKey(it.ref);
    this.cache.set(key, canvas, canvas.width * canvas.height, (k) => {
      const id = k.slice(0, k.lastIndexOf(":"));
      return this.items.has(id);
    });
    if (this.items.get(it.ref.id) === it && !it.frame.querySelector("canvas")) it.frame.appendChild(canvas);
  }

  private async render(it: Item, signal: AbortSignal): Promise<void> {
    // The main view usually has this page drawn already: shrinking that
    // bitmap costs ~nothing, while rendering again means re-parsing the page
    // and re-decoding its images (for a photo page as much work as the page).
    const drawn = this.renderedPage(it.ref);
    if (drawn && drawn.width > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(THUMB_W * this.dpr);
      canvas.height = Math.max(1, Math.round((canvas.width * drawn.height) / drawn.width));
      const ctx = canvas.getContext("2d", { alpha: false });
      if (ctx) {
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(drawn, 0, 0, canvas.width, canvas.height);
        return this.keep(it, canvas);
      }
    }
    const pageP = this.store.getPage(it.ref);
    if (!pageP) return;
    const page: PDFPageProxy = await pageP;
    if (signal.aborted) return;
    const rotation = this.store.rotation(it.ref);
    const box = this.store.viewBox(it.ref);
    const base = cropViewport(page, box, 1, rotation);
    const crop = cropViewport(page, box, (THUMB_W * this.dpr) / base.width, rotation);
    const vp = crop.viewport;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.width));
    canvas.height = Math.max(1, Math.round(crop.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport: vp,
      annotationMode: AnnotationMode.ENABLE,
      background: "white",
    } as Parameters<PDFPageProxy["render"]>[0]);
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort);
    try {
      await task.promise;
    } catch (err) {
      freeCanvas(canvas);
      if (!isAbort(err)) console.warn("thumbnail failed", err);
      return;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    this.keep(it, canvas);
  }
}
