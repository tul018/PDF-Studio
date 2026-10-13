/**
 * Pure layout maths for the virtualized page list. Pages are stacked
 * vertically; only offsets are stored (O(n) memory, a few bytes per page), so
 * a 10 000-page document costs nothing until pages scroll into view.
 */
export interface Size {
  width: number;
  height: number;
}

export const PAGE_GAP = 12;
export const PAGE_MARGIN_TOP = 12;

export class PageLayout {
  /** Unscaled (zoom = 1, CSS px) page sizes, rotation already applied. */
  private sizes: Size[] = [];
  /** Top of each row (pages side by side share a row), plus the end. */
  private offsets: Float64Array = new Float64Array(0);
  /** Row of each page, and the first page of each row. */
  private rowOf: Uint32Array = new Uint32Array(0);
  private rowStart: Uint32Array = new Uint32Array(0);
  private dirty = true;
  zoom = 1;
  /** 1 = continuous column; 2 = two pages side by side (book). */
  columns: 1 | 2 = 1;
  /** In two-page mode the first page (a cover) sits alone, like a book. */
  coverAlone = true;

  setSizes(sizes: Size[]): void {
    this.sizes = sizes.slice();
    this.dirty = true;
  }

  setSize(index: number, size: Size): boolean {
    const old = this.sizes[index];
    if (old && Math.abs(old.width - size.width) < 0.01 && Math.abs(old.height - size.height) < 0.01) {
      return false;
    }
    this.sizes[index] = size;
    this.dirty = true;
    return true;
  }

  setZoom(zoom: number): void {
    if (zoom !== this.zoom) {
      this.zoom = zoom;
      this.dirty = true;
    }
  }

  setColumns(columns: 1 | 2, coverAlone = true): void {
    if (columns !== this.columns || coverAlone !== this.coverAlone) {
      this.columns = columns;
      this.coverAlone = coverAlone;
      this.dirty = true;
    }
  }

  get count(): number {
    return this.sizes.length;
  }

  baseSize(i: number): Size {
    return this.sizes[i];
  }

  /** Scaled size in CSS px. */
  size(i: number): Size {
    const s = this.sizes[i];
    return { width: Math.round(s.width * this.zoom), height: Math.round(s.height * this.zoom) };
  }

  private ensure(): void {
    if (!this.dirty) return;
    const n = this.sizes.length;
    const rowOf = new Uint32Array(n);
    const starts: number[] = [];
    for (let i = 0; i < n; ) {
      starts.push(i);
      const pair = this.columns === 2 && !(this.coverAlone && i === 0) && i + 1 < n;
      rowOf[i] = starts.length - 1;
      if (pair) rowOf[i + 1] = starts.length - 1;
      i += pair ? 2 : 1;
    }
    const rows = starts.length;
    const off = new Float64Array(rows + 1);
    let y = PAGE_MARGIN_TOP;
    for (let r = 0; r < rows; r++) {
      off[r] = y;
      const a = starts[r],
        b = r + 1 < rows ? starts[r + 1] : n;
      let h = 0;
      for (let i = a; i < b; i++) h = Math.max(h, Math.round(this.sizes[i].height * this.zoom));
      y += h + PAGE_GAP;
    }
    off[rows] = y;
    this.offsets = off;
    this.rowOf = rowOf;
    this.rowStart = Uint32Array.from([...starts, n]);
    this.dirty = false;
  }

  top(i: number): number {
    this.ensure();
    return this.offsets[this.rowOf[i]];
  }

  totalHeight(): number {
    this.ensure();
    return this.offsets[this.offsets.length - 1] ?? 0;
  }

  /** Pages in the same row as page i: [first, last]. */
  row(i: number): [number, number] {
    this.ensure();
    const r = this.rowOf[i];
    return [this.rowStart[r], this.rowStart[r + 1] - 1];
  }

  /** Unscaled width of a row (pages side by side, with the gap between them at zoom 1). */
  rowBaseWidth(i: number): number {
    const [a, b] = this.row(i);
    let w = 0;
    for (let k = a; k <= b; k++) w += this.sizes[k].width;
    return w + (b - a) * PAGE_GAP;
  }

  maxWidth(): number {
    this.ensure();
    let w = 0;
    for (let r = 0; r + 1 < this.rowStart.length; r++) {
      let rw = 0;
      for (let i = this.rowStart[r]; i < this.rowStart[r + 1]; i++) rw += Math.round(this.sizes[i].width * this.zoom);
      rw += (this.rowStart[r + 1] - this.rowStart[r] - 1) * PAGE_GAP;
      if (rw > w) w = rw;
    }
    return w;
  }

  /** Index of the (first) page of the row containing y (binary search). */
  indexAt(y: number): number {
    this.ensure();
    const n = this.sizes.length;
    if (n === 0) return -1;
    let lo = 0;
    let hi = this.rowStart.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return this.rowStart[lo];
  }

  /** Inclusive range of pages intersecting [top, bottom]. */
  visibleRange(top: number, bottom: number): [number, number] {
    const n = this.sizes.length;
    if (n === 0) return [0, -1];
    const first = this.indexAt(top);
    let last = this.row(this.indexAt(bottom))[1];
    if (last < first) last = first;
    return [first, Math.min(n - 1, last)];
  }
}

/**
 * Render scale for a page: zoom * dpr, clamped so the bitmap never exceeds
 * maxPixels. Returns the scale and whether it was clamped (=> a high-res
 * "detail" tile is needed for the visible part of the page).
 */
export function clampRenderScale(
  baseWidth: number,
  baseHeight: number,
  desiredScale: number,
  maxPixels: number,
): { scale: number; clamped: boolean } {
  const px = baseWidth * baseHeight * desiredScale * desiredScale;
  if (px <= maxPixels) return { scale: desiredScale, clamped: false };
  return { scale: Math.sqrt(maxPixels / (baseWidth * baseHeight)), clamped: true };
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-3) ?? ZOOM_MAX;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z - 1e-3) return ZOOM_STEPS[i];
  return ZOOM_MIN;
}
