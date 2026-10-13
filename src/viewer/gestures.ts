import type { Viewer } from "./viewer";

/**
 * Zoom gestures:
 *  - Ctrl/Cmd + wheel and Windows precision-touchpad pinch (arrives as
 *    ctrl+wheel) zoom around the cursor.
 *  - Two-finger pinch on iPhone/iPad/touch screens zooms around the fingers
 *    and pans with them - works even while a drawing tool is active.
 * Native page zoom is suppressed so the WebView never rescales the UI.
 */
export function attachGestures(viewer: Viewer): void {
  const el = viewer.scroller;

  el.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 300 : 1;
      const factor = Math.exp((-e.deltaY * unit) / 300);
      viewer.setZoom(viewer.zoom * factor, { x: e.clientX, y: e.clientY });
    },
    { passive: false },
  );

  let start: { dist: number; zoom: number; cx: number; cy: number; sl: number; st: number } | null = null;
  let raf = 0;
  const center = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  el.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        const c = center(e.touches);
        start = { dist: dist(e.touches), zoom: viewer.zoom, cx: c.x, cy: c.y, sl: el.scrollLeft, st: el.scrollTop };
      }
    },
    { passive: true },
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const d = dist(e.touches);
      const c = center(e.touches);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!start) return;
        const z = (start.zoom * d) / Math.max(1, start.dist);
        viewer.setZoom(z, c);
        // Two-finger pan
        el.scrollLeft -= c.x - start.cx;
        el.scrollTop -= c.y - start.cy;
        start.cx = c.x;
        start.cy = c.y;
      });
    },
    { passive: false },
  );
  const end = (e: TouchEvent) => {
    if (e.touches.length < 2) start = null;
  };
  el.addEventListener("touchend", end, { passive: true });
  el.addEventListener("touchcancel", end, { passive: true });
  // iOS Safari/WKWebView proprietary gesture events -> block native zoom.
  for (const t of ["gesturestart", "gesturechange", "gestureend"]) {
    el.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  }
}
