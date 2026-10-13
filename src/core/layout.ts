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
  private offsets: Float64Array = new Float64Array(0);
  private dirty = true;
  zoom = 1;

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
    const off = new Float64Array(n + 1);
    let y = PAGE_MARGIN_TOP;
    for (let i = 0; i < n; i++) {
      off[i] = y;
      y += Math.round(this.sizes[i].height * this.zoom) + PAGE_GAP;
    }
    off[n] = y;
    this.offsets = off;
    this.dirty = false;
  }

  top(i: number): number {
    this.ensure();
    return this.offsets[i];
  }

  totalHeight(): number {
    this.ensure();
    return this.offsets[this.sizes.length] ?? 0;
  }

  maxWidth(): number {
    let w = 0;
    for (const s of this.sizes) if (s.width > w) w = s.width;
    return Math.round(w * this.zoom);
  }

  /** Index of the page containing y (binary search). */
  indexAt(y: number): number {
    this.ensure();
    const n = this.sizes.length;
    if (n === 0) return -1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Inclusive range of pages intersecting [top, bottom]. */
  visibleRange(top: number, bottom: number): [number, number] {
    const n = this.sizes.length;
    if (n === 0) return [0, -1];
    const first = this.indexAt(top);
    let last = this.indexAt(bottom);
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
