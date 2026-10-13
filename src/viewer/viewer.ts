import { AnnotationMode, TextLayer, type PDFPageProxy } from "pdfjs-dist";
import { CSS_UNITS, type DocumentStore } from "../core/documents";
import { degradeProfile, type DeviceProfile } from "../core/deviceProfile";
import { clampRenderScale, clampZoom, PageLayout } from "../core/layout";
import { isAbort, RenderQueue } from "../core/renderQueue";
import { makeView, type View } from "../core/viewport";
import type { PageRef } from "../edit/model";

/** A mounted page. Only pages near the viewport have a Slot (and a canvas). */
export interface Slot {
  ref: PageRef;
  index: number;
  el: HTMLDivElement;
  /** Layer for annotations, forms, links (owned by decorators). */
  layers: HTMLDivElement;
  view: View;
  canvas: HTMLCanvasElement | null;
  canvasZoom: number;
  canvasPixels: number;
  canvasClamped: boolean;
  detail: HTMLCanvasElement | null;
  detailPixels: number;
  textDiv: HTMLDivElement | null;
  textLayer: TextLayer | null;
  textZoom: number;
  failed: boolean;
}

export interface Decorator {
  /** Page mounted or its view (zoom/rotation) changed. */
  decorate(slot: Slot): void;
  undecorate(slot: Slot): void;
}

export type FitMode = "none" | "width" | "page";

const SIDE_PAD = 16;

/**
 * Virtualized, memory-bounded page view.
 *
 *  - Only pages within the viewport (+/- a small prefetch window) exist in the
 *    DOM. Everything else is a number in a Float64Array.
 *  - Canvases are released explicitly (width = height = 0) when a page leaves
 *    the window: WebKit otherwise keeps the backing store alive until GC, the
 *    classic cause of iOS "A problem repeatedly occurred" crashes.
 *  - Each canvas is clamped to a per-page pixel cap derived from the device
 *    profile. When zoomed beyond the cap, a viewport-sized "detail" tile is
 *    rendered at full resolution for just the visible region.
 *  - On zoom the old bitmap stays, CSS-stretched, until the new one is ready:
 *    no white flashes, no layout jumps.
 */
export class Viewer {
  readonly layout = new PageLayout();
  readonly queue: RenderQueue;
  private pagesEl: HTMLDivElement;
  private pages: readonly PageRef[] = [];
  private slots = new Map<string, Slot>();
  private decorators: Decorator[] = [];
  private zoomValue = 1;
  private fit: FitMode = "width";
  private rafPending = false;
  private settleTimer = 0;
  private zoomRenderTimer = 0;
  private current = 0;
  private unmountedSinceCleanup = 0;
  private cleanupTimer = 0;
  private dpr = 1;
  private share = 1;
  private resizeObs: ResizeObserver;
  private offSize: () => void;
  onPageChange: (index: number) => void = () => {};
  onZoomChange: (zoom: number) => void = () => {};
  onRenderError: (msg: string) => void = () => {};

  constructor(
    readonly scroller: HTMLElement,
    private store: DocumentStore,
    private profile: DeviceProfile,
  ) {
    this.queue = new RenderQueue(profile.renderConcurrency);
    this.pagesEl = document.createElement("div");
    this.pagesEl.className = "pages";
    scroller.appendChild(this.pagesEl);
    this.updateDpr();

    scroller.addEventListener("scroll", () => this.requestUpdate(), { passive: true });
    let lastW = -1,
      lastH = -1;
    this.resizeObs = new ResizeObserver(() => {
      // Defer to the next frame and ignore no-op notifications, so that
      // fit-to-width <-> scrollbar appearance can't feed back into a loop.
      requestAnimationFrame(() => {
        const w = scroller.clientWidth,
          h = scroller.clientHeight;
        if (w === lastW && h === lastH) return;
        const widthChanged = Math.abs(w - lastW) > 24 || this.fit === "page";
        lastW = w;
        lastH = h;
        if (this.fit !== "none" && widthChanged) this.applyFit();
        else this.requestUpdate();
      });
    });
    this.resizeObs.observe(scroller);
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.("change", () => {
      this.updateDpr();
      this.invalidateAll();
    });
    this.offSize = store.onSize((docId, index) => this.onMetaLoaded(docId, index));
  }

  private updateDpr(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.profile.maxDpr);
  }

  addDecorator(d: Decorator): void {
    this.decorators.push(d);
    for (const s of this.slots.values()) d.decorate(s);
  }

  get zoom(): number {
    return this.zoomValue;
  }

  get fitMode(): FitMode {
    return this.fit;
  }

  get currentIndex(): number {
    return this.current;
  }

  get pageList(): readonly PageRef[] {
    return this.pages;
  }

  slot(pageId: string): Slot | undefined {
    return this.slots.get(pageId);
  }

  mountedSlots(): Slot[] {
    return [...this.slots.values()];
  }

  /** Pixels currently held by page canvases (for diagnostics/tests). */
  get canvasPixels(): number {
    let n = 0;
    for (const s of this.slots.values()) n += s.canvasPixels + s.detailPixels;
    return n;
  }

  // ------------------------------------------------------------ pages

  setPages(pages: readonly PageRef[], keepPosition = true): void {
    const anchor = keepPosition ? this.captureAnchor() : null;
    const prevCurrentId = this.pages[this.current]?.id;
    this.pages = pages;
    this.layout.setSizes(pages.map((p) => this.store.displaySize(p)));
    const byId = new Map(pages.map((p, i) => [p.id, i] as const));
    for (const [id, slot] of [...this.slots]) {
      const i = byId.get(id);
      if (i === undefined || pages[i] !== slot.ref) {
        // Removed, or rotation changed: drop and remount.
        this.unmount(slot);
      } else {
        slot.index = i;
      }
    }
    this.applyLayoutSize();
    if (anchor && prevCurrentId && byId.has(prevCurrentId)) {
      const idx = byId.get(prevCurrentId)!;
      if (anchor.pageId === prevCurrentId) this.restoreAnchor({ ...anchor });
      else this.scrollToPage(idx);
    } else if (anchor) {
      this.restoreAnchor(anchor);
    }
    if (this.fit !== "none") this.applyFit();
    this.requestUpdate();
  }

  private onMetaLoaded(docId: string, index: number): void {
    let changed = false;
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p.docId === docId && (p.srcIndex === index || index === 0)) {
        if (this.layout.setSize(i, this.store.displaySize(p))) changed = true;
      }
    }
    if (!changed) return;
    const anchor = this.captureAnchor();
    this.applyLayoutSize();
    if (anchor) this.restoreAnchor(anchor);
    for (const s of this.slots.values()) this.positionSlot(s);
    this.requestUpdate();
  }

  // ------------------------------------------------------------ zoom

  setZoom(z: number, anchorClient?: { x: number; y: number }, fit: FitMode = "none"): void {
    z = clampZoom(z);
    this.fit = fit;
    if (Math.abs(z - this.zoomValue) < 1e-4) return;
    const rect = this.scroller.getBoundingClientRect();
    const ax = anchorClient ? anchorClient.x - rect.left : this.scroller.clientWidth / 2;
    // Fit modes and a document still at its top keep the top edge fixed;
    // manual zoom keeps the viewport centre (or the pointer) fixed.
    const atTop = this.scroller.scrollTop < 2;
    const ay = anchorClient
      ? anchorClient.y - rect.top
      : fit !== "none" || atTop
        ? 0
        : this.scroller.clientHeight / 2;
    const anchor = this.captureAnchor(ax, ay);
    this.zoomValue = z;
    this.layout.setZoom(z);
    this.applyLayoutSize();
    if (anchor) this.restoreAnchor(anchor, ax, ay);
    for (const s of this.slots.values()) {
      this.positionSlot(s);
      this.removeDetail(s);
      for (const d of this.decorators) d.decorate(s);
    }
    this.onZoomChange(z);
    // Re-render only after the gesture settles; until then the existing
    // bitmaps are CSS-scaled (cheap, smooth).
    clearTimeout(this.zoomRenderTimer);
    this.zoomRenderTimer = window.setTimeout(() => this.requestUpdate(), 160);
    this.requestUpdate(false);
  }

  setFit(mode: FitMode): void {
    this.fit = mode;
    this.applyFit();
  }

  private applyFit(): void {
    if (!this.pages.length || this.fit === "none") return;
    const s = this.layout.baseSize(Math.min(this.current, this.pages.length - 1));
    const availW = this.scroller.clientWidth - SIDE_PAD * 2;
    const availH = this.scroller.clientHeight - 24;
    let z = availW / s.width;
    if (this.fit === "page") z = Math.min(z, availH / s.height);
    const mode = this.fit;
    this.setZoom(z, undefined, mode);
  }

  // ------------------------------------------------------------ navigation

  scrollToPage(index: number, pdfPoint?: [number, number]): void {
    if (index < 0 || index >= this.pages.length) return;
    let y = this.layout.top(index) - 8;
    let x: number | null = null;
    if (pdfPoint) {
      const v = this.viewFor(this.pages[index]);
      const [vx, vy] = v.toView(pdfPoint[0], pdfPoint[1]);
      y = this.layout.top(index) + vy - 40;
      x = this.pageLeft(index) + vx - this.scroller.clientWidth / 2;
    }
    this.scroller.scrollTop = Math.max(0, y);
    if (x !== null) this.scroller.scrollLeft = Math.max(0, x);
    this.setCurrent(index);
    this.requestUpdate();
  }

  /** Current reading position: page index + vertical fraction within it. */
  position(): { index: number; fy: number } {
    if (!this.pages.length) return { index: 0, fy: 0 };
    const y = this.scroller.scrollTop + 8;
    const i = Math.max(0, this.layout.indexAt(y));
    const h = Math.max(1, this.layout.size(i).height);
    return { index: i, fy: Math.min(1, Math.max(0, (y - this.layout.top(i)) / h)) };
  }

  scrollToPosition(index: number, fy: number): void {
    if (index < 0 || index >= this.pages.length) return;
    this.scroller.scrollTop = this.layout.top(index) + fy * this.layout.size(index).height - 8;
    this.setCurrent(index);
    this.requestUpdate();
  }

  /** Share of the device canvas budget (0.5 each in split view). */
  set budgetShare(f: number) {
    this.share = f;
    this.invalidateAll();
  }

  next(): void {
    this.scrollToPage(Math.min(this.pages.length - 1, this.current + 1));
  }

  prev(): void {
    this.scrollToPage(Math.max(0, this.current - 1));
  }

  viewFor(ref: PageRef, zoom = this.zoomValue): View {
    return makeView(this.store.viewBox(ref), zoom * CSS_UNITS, this.store.rotation(ref));
  }

  /** Content-space x of a page's left edge. */
  pageLeft(i: number): number {
    const contentW = this.contentWidth();
    return Math.max(SIDE_PAD, (contentW - this.layout.size(i).width) / 2);
  }

  private contentWidth(): number {
    return Math.max(this.scroller.clientWidth, this.layout.maxWidth() + SIDE_PAD * 2);
  }

  private applyLayoutSize(): void {
    this.pagesEl.style.height = `${this.layout.totalHeight()}px`;
    this.pagesEl.style.width = `${this.contentWidth()}px`;
  }

  private captureAnchor(ax = 0, ay = 0): { pageId: string; fx: number; fy: number } | null {
    if (!this.pages.length) return null;
    const y = this.scroller.scrollTop + ay;
    const i = this.layout.indexAt(y);
    if (i < 0) return null;
    const size = this.layout.size(i);
    const fy = (y - this.layout.top(i)) / Math.max(1, size.height);
    const fx = (this.scroller.scrollLeft + ax - this.pageLeft(i)) / Math.max(1, size.width);
    return { pageId: this.pages[i].id, fx, fy };
  }

  private restoreAnchor(a: { pageId: string; fx: number; fy: number }, ax = 0, ay = 0): void {
    const i = this.pages.findIndex((p) => p.id === a.pageId);
    if (i < 0) return;
    const size = this.layout.size(i);
    this.scroller.scrollTop = this.layout.top(i) + a.fy * size.height - ay;
    this.scroller.scrollLeft = this.pageLeft(i) + a.fx * size.width - ax;
  }

  private setCurrent(i: number): void {
    if (i !== this.current) {
      this.current = i;
      this.onPageChange(i);
    }
  }

  // ------------------------------------------------------------ update loop

  requestUpdate(render = true): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.update(render);
    });
  }

  private update(render: boolean): void {
    const n = this.pages.length;
    if (!n) return;
    const top = this.scroller.scrollTop;
    const bottom = top + this.scroller.clientHeight;
    const [first, last] = this.layout.visibleRange(top, bottom);
    const mid = this.layout.indexAt(top + this.scroller.clientHeight * 0.4);
    this.setCurrent(Math.max(0, mid));

    const pf = this.profile.prefetchPages;
    const keepFrom = Math.max(0, first - pf);
    const keepTo = Math.min(n - 1, last + pf);

    for (const slot of [...this.slots.values()]) {
      if (slot.index < keepFrom || slot.index > keepTo) this.unmount(slot);
    }
    for (let i = keepFrom; i <= keepTo; i++) {
      const ref = this.pages[i];
      if (!this.slots.has(ref.id)) this.mount(ref, i);
      if (ref.docId && !this.store.metaOf(ref)) void this.store.loadMeta(ref.docId, ref.srcIndex);
    }
    this.queue.retain((key) => {
      const id = key.slice(key.indexOf(":") + 1);
      if (key.startsWith("thumb:")) return true;
      return this.slots.has(id);
    });

    if (!render) return;
    const center = (top + bottom) / 2;
    const perPageCap = Math.min(
      this.profile.maxCanvasPixels,
      Math.floor((this.profile.canvasBudgetPixels * this.share) / Math.max(1, this.slots.size)),
    );
    for (const slot of this.slots.values()) {
      if (!slot.ref.docId || slot.failed) continue;
      const visible = slot.index >= first && slot.index <= last;
      const pageMid = this.layout.top(slot.index) + this.layout.size(slot.index).height / 2;
      const priority = Math.abs(pageMid - center) + (visible ? 0 : 1e6);
      if (slot.canvasZoom !== this.zoomValue && !this.queue.isRunning(`page:${slot.ref.id}`)) {
        this.queue.schedule({
          key: `page:${slot.ref.id}`,
          priority,
          run: (signal) => this.renderSlot(slot, perPageCap, signal),
        });
      }
    }
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.onSettled(first, last), 180);
  }

  /** Scrolling stopped: build text layers and detail tiles for visible pages. */
  private onSettled(first: number, last: number): void {
    for (const slot of this.slots.values()) {
      if (slot.index < first || slot.index > last) continue;
      if (slot.canvas && slot.canvasZoom === this.zoomValue) {
        if (slot.textZoom !== this.zoomValue) void this.buildTextLayer(slot);
        if (slot.canvasClamped) {
          this.queue.schedule({
            key: `detail:${slot.ref.id}`,
            priority: -1,
            run: (signal) => this.renderDetail(slot, signal),
          });
        }
      }
    }
  }

  // ------------------------------------------------------------ mount

  private mount(ref: PageRef, index: number): Slot {
    const el = document.createElement("div");
    el.className = "page loading";
    el.dataset.pageId = ref.id;
    el.dataset.pageNumber = String(index + 1);
    const layers = document.createElement("div");
    layers.className = "page-layers";
    el.appendChild(layers);
    if (!ref.docId) el.classList.remove("loading");
    const slot: Slot = {
      ref,
      index,
      el,
      layers,
      view: this.viewFor(ref),
      canvas: null,
      canvasZoom: 0,
      canvasPixels: 0,
      canvasClamped: false,
      detail: null,
      detailPixels: 0,
      textDiv: null,
      textLayer: null,
      textZoom: 0,
      failed: false,
    };
    this.slots.set(ref.id, slot);
    this.positionSlot(slot);
    this.pagesEl.appendChild(el);
    for (const d of this.decorators) d.decorate(slot);
    return slot;
  }

  private positionSlot(slot: Slot): void {
    const i = slot.index;
    const size = this.layout.size(i);
    slot.view = this.viewFor(slot.ref);
    const st = slot.el.style;
    st.top = `${this.layout.top(i)}px`;
    st.left = `${this.pageLeft(i)}px`;
    st.width = `${size.width}px`;
    st.height = `${size.height}px`;
    slot.el.dataset.pageNumber = String(i + 1);
    if (slot.textDiv) slot.textDiv.hidden = slot.textZoom !== this.zoomValue;
  }

  private unmount(slot: Slot): void {
    this.queue.cancel(`page:${slot.ref.id}`);
    this.queue.cancel(`detail:${slot.ref.id}`);
    for (const d of this.decorators) d.undecorate(slot);
    freeCanvas(slot.canvas);
    slot.canvas = null;
    slot.canvasPixels = 0;
    this.removeDetail(slot);
    slot.textLayer?.cancel();
    slot.textLayer = null;
    slot.el.remove();
    this.slots.delete(slot.ref.id);
    // Drop PDF.js' per-page operator lists / decoded images for this page.
    const p = this.store.getPage(slot.ref);
    p?.then((page) => {
      if (!this.slots.has(slot.ref.id)) page.cleanup();
    }).catch(() => {});
    this.unmountedSinceCleanup++;
    this.scheduleDocCleanup();
  }

  /**
   * After many pages have been scrolled past and nothing is rendering, ask
   * PDF.js to free fonts/images cached in its worker. This is what keeps
   * memory flat when reading a 3 000-page scanned book cover to cover.
   */
  private scheduleDocCleanup(): void {
    if (this.unmountedSinceCleanup < 40) return;
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = window.setTimeout(async () => {
      await this.queue.whenIdle();
      if (!this.queue.idle) return;
      this.unmountedSinceCleanup = 0;
      for (const d of this.store.docs.values()) await d.pdf.cleanup(true).catch(() => {});
    }, 2000);
  }

  private removeDetail(slot: Slot): void {
    this.queue.cancel(`detail:${slot.ref.id}`);
    freeCanvas(slot.detail);
    slot.detail?.remove();
    slot.detail = null;
    slot.detailPixels = 0;
  }

  /** Tear down (closing a split pane or the document). */
  destroy(): void {
    for (const s of [...this.slots.values()]) this.unmount(s);
    this.queue.cancelAll();
    this.pages = [];
    this.pagesEl.remove();
    this.resizeObs.disconnect();
    this.offSize();
  }

  invalidateAll(): void {
    for (const s of this.slots.values()) {
      s.canvasZoom = 0;
      s.textZoom = 0;
      s.failed = false;
    }
    this.requestUpdate();
  }

  /** Re-run decorators (annotations changed). */
  redecorate(pageId?: string): void {
    for (const s of this.slots.values()) {
      if (pageId && s.ref.id !== pageId) continue;
      for (const d of this.decorators) d.decorate(s);
    }
  }

  // ------------------------------------------------------------ rendering

  private async renderSlot(slot: Slot, pixelCap: number, signal: AbortSignal): Promise<void> {
    const pageP = this.store.getPage(slot.ref);
    if (!pageP) return;
    const page = await pageP;
    if (signal.aborted || !this.slots.has(slot.ref.id)) return;
    const zoom = this.zoomValue;
    const rotation = this.store.rotation(slot.ref);
    const base = page.getViewport({ scale: 1, rotation });
    const desired = zoom * CSS_UNITS * this.dpr;
    let { scale, clamped } = clampRenderScale(base.width, base.height, desired, pixelCap);
    const ok = await this.paint(slot, page, scale, rotation, signal);
    if (ok === "oom") {
      // Canvas allocation failed: shrink budgets and retry once smaller.
      degradeProfile(this.profile);
      scale = clampRenderScale(base.width, base.height, desired, this.profile.maxCanvasPixels).scale;
      clamped = true;
      if ((await this.paint(slot, page, scale, rotation, signal)) !== "ok") {
        slot.failed = true;
        this.onRenderError(`Page ${slot.index + 1} is too large to display on this device.`);
        return;
      }
    } else if (ok !== "ok") {
      return;
    }
    slot.canvasZoom = zoom;
    slot.canvasClamped = clamped;
    slot.el.classList.remove("loading");
    // Zoom may have changed meanwhile; also lets text layers/details settle.
    this.requestUpdate();
  }

  private async paint(
    slot: Slot,
    page: PDFPageProxy,
    scale: number,
    rotation: number,
    signal: AbortSignal,
  ): Promise<"ok" | "oom" | "aborted" | "error"> {
    const vp = page.getViewport({ scale, rotation });
    const canvas = document.createElement("canvas");
    canvas.className = "page-canvas";
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx || canvas.width === 0) return "oom";
    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport: vp,
      annotationMode: AnnotationMode.ENABLE_FORMS,
      background: "white",
    } as Parameters<PDFPageProxy["render"]>[0]);
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort);
    try {
      await task.promise;
    } catch (err) {
      freeCanvas(canvas);
      if (isAbort(err) || signal.aborted) return "aborted";
      console.error("render failed", err);
      const msg = String((err as Error)?.message ?? err);
      if (/memory|allocation|too large|canvas/i.test(msg)) return "oom";
      slot.failed = true;
      slot.el.classList.add("error");
      slot.el.classList.remove("loading");
      return "error";
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted || !this.slots.has(slot.ref.id)) {
      freeCanvas(canvas);
      return "aborted";
    }
    // Swap bitmaps atomically - the old one stays visible until now.
    const old = slot.canvas;
    slot.el.insertBefore(canvas, slot.el.firstChild);
    slot.canvas = canvas;
    slot.canvasPixels = canvas.width * canvas.height;
    if (old) {
      old.remove();
      freeCanvas(old);
    }
    return "ok";
  }

  /** Full-resolution tile of just the visible part of a clamped page. */
  private async renderDetail(slot: Slot, signal: AbortSignal): Promise<void> {
    const page = await this.store.getPage(slot.ref);
    if (!page || signal.aborted || !this.slots.has(slot.ref.id)) return;
    const zoom = this.zoomValue;
    const i = slot.index;
    const size = this.layout.size(i);
    const pageTop = this.layout.top(i);
    const pageLeft = this.pageLeft(i);
    const vx0 = Math.max(0, this.scroller.scrollLeft - pageLeft);
    const vy0 = Math.max(0, this.scroller.scrollTop - pageTop);
    const vx1 = Math.min(size.width, this.scroller.scrollLeft + this.scroller.clientWidth - pageLeft);
    const vy1 = Math.min(size.height, this.scroller.scrollTop + this.scroller.clientHeight - pageTop);
    if (vx1 <= vx0 || vy1 <= vy0) return;
    // Pad so small scrolls stay sharp.
    const pad = 128;
    const x0 = Math.max(0, vx0 - pad),
      y0 = Math.max(0, vy0 - pad);
    const x1 = Math.min(size.width, vx1 + pad),
      y1 = Math.min(size.height, vy1 + pad);
    const dpr = this.dpr;
    const rotation = this.store.rotation(slot.ref);
    const vp = page.getViewport({ scale: zoom * CSS_UNITS * dpr, rotation });
    const canvas = document.createElement("canvas");
    canvas.className = "page-detail";
    canvas.width = Math.ceil((x1 - x0) * dpr);
    canvas.height = Math.ceil((y1 - y0) * dpr);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport: vp,
      transform: [1, 0, 0, 1, -x0 * dpr, -y0 * dpr],
      annotationMode: AnnotationMode.ENABLE_FORMS,
      background: "white",
    } as Parameters<PDFPageProxy["render"]>[0]);
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort);
    try {
      await task.promise;
    } catch (err) {
      freeCanvas(canvas);
      if (!isAbort(err)) console.warn("detail render failed", err);
      return;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted || zoom !== this.zoomValue || !this.slots.has(slot.ref.id)) {
      freeCanvas(canvas);
      return;
    }
    this.removeDetail(slot);
    Object.assign(canvas.style, {
      left: `${x0}px`,
      top: `${y0}px`,
      width: `${x1 - x0}px`,
      height: `${y1 - y0}px`,
    });
    slot.canvas?.after(canvas);
    slot.detail = canvas;
    slot.detailPixels = canvas.width * canvas.height;
  }

  private async buildTextLayer(slot: Slot): Promise<void> {
    const page = await this.store.getPage(slot.ref);
    if (!page || !this.slots.has(slot.ref.id)) return;
    const zoom = this.zoomValue;
    slot.textLayer?.cancel();
    slot.textDiv?.remove();
    const div = document.createElement("div");
    div.className = "textLayer";
    const scale = zoom * CSS_UNITS;
    div.style.setProperty("--total-scale-factor", String(scale));
    div.style.setProperty("--scale-factor", String(scale));
    div.style.setProperty("--scale-round-x", "1px");
    div.style.setProperty("--scale-round-y", "1px");
    const viewport = page.getViewport({ scale, rotation: this.store.rotation(slot.ref) });
    const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport });
    slot.textLayer = tl;
    slot.textDiv = div;
    slot.textZoom = zoom;
    slot.layers.before(div);
    try {
      await tl.render();
    } catch (err) {
      if (!isAbort(err)) console.warn("text layer failed", err);
    }
  }
}

/** Release a canvas' backing store immediately (critical on iOS/WebKit). */
export function freeCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}
