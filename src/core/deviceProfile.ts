/**
 * Device memory profile.
 *
 * The #1 cause of PDF viewer crashes is unbounded memory: every rendered page
 * is a bitmap of width*height*4 bytes. An A4 page at 200% zoom on a 3x
 * retina screen is ~5000x7000 px = 140 MB. A few of those and iOS kills the
 * WebView (WKWebView's total canvas memory is capped, and individual canvases
 * above 16.7 Mpx silently fail to draw).
 *
 * Every render decision in the app is bounded by the numbers computed here.
 */
export interface DeviceProfile {
  isIOS: boolean;
  isTouch: boolean;
  /** Approximate RAM in GB (navigator.deviceMemory, or a conservative guess). */
  memoryGB: number;
  /** Hard cap for a single canvas, in pixels. */
  maxCanvasPixels: number;
  /** Total pixels of all live page canvases (main + detail + thumbnails). */
  canvasBudgetPixels: number;
  /** How many pages above/below the viewport to pre-render. */
  prefetchPages: number;
  /** Concurrency of the render queue. */
  renderConcurrency: number;
  /** Cap device-pixel-ratio used for rendering (3x retina is wasteful). */
  maxDpr: number;
}

export interface ProfileInput {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
}

export function detectIOS(i: ProfileInput): boolean {
  if (/iPad|iPhone|iPod/.test(i.userAgent)) return true;
  // iPadOS 13+ reports itself as "Macintosh" but has touch.
  return /Macintosh/.test(i.userAgent) && (i.maxTouchPoints ?? 0) > 1;
}

export function computeProfile(i: ProfileInput): DeviceProfile {
  const isIOS = detectIOS(i);
  const isTouch = (i.maxTouchPoints ?? 0) > 0;
  // deviceMemory is Chromium-only and capped at 8. WebKit gives nothing, so
  // assume an iPhone-class budget there.
  const memoryGB = i.deviceMemory ?? (isIOS ? 3 : 8);

  const MP = 1024 * 1024;
  let canvasBudgetPixels: number;
  let maxCanvasPixels: number;
  if (isIOS) {
    // WebKit: hard limit 16.7 Mpx per canvas; total canvas memory ~ 256-384MB
    // before jetsam. Stay well below.
    maxCanvasPixels = 8 * MP;
    canvasBudgetPixels = memoryGB >= 6 ? 48 * MP : 32 * MP;
  } else {
    maxCanvasPixels = 16 * MP;
    canvasBudgetPixels = memoryGB >= 8 ? 128 * MP : memoryGB >= 4 ? 80 * MP : 48 * MP;
  }

  return {
    isIOS,
    isTouch,
    memoryGB,
    maxCanvasPixels,
    canvasBudgetPixels,
    prefetchPages: memoryGB >= 4 && !isIOS ? 2 : 1,
    renderConcurrency: 2,
    maxDpr: isIOS ? 2 : 3,
  };
}

let cached: DeviceProfile | null = null;
export function getProfile(): DeviceProfile {
  if (!cached) {
    const nav = navigator as Navigator & { deviceMemory?: number };
    cached = computeProfile({
      userAgent: nav.userAgent,
      platform: nav.platform,
      maxTouchPoints: nav.maxTouchPoints,
      deviceMemory: nav.deviceMemory,
    });
  }
  return cached;
}

/** Called after a canvas allocation fails: halve budgets and keep going. */
export function degradeProfile(p: DeviceProfile): void {
  p.canvasBudgetPixels = Math.max(8 * 1024 * 1024, Math.floor(p.canvasBudgetPixels / 2));
  p.maxCanvasPixels = Math.max(2 * 1024 * 1024, Math.floor(p.maxCanvasPixels / 2));
  p.prefetchPages = 0;
}
