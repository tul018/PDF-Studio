import { describe, expect, it } from "vitest";
import { computeProfile } from "../../src/core/deviceProfile";
import { clampRenderScale, nextZoom, PageLayout } from "../../src/core/layout";
import { WeightedLRU } from "../../src/core/lru";
import { RenderQueue } from "../../src/core/renderQueue";
import { makeView } from "../../src/core/viewport";

describe("PageLayout", () => {
  it("binary-searches visible pages in a 10 000-page document", () => {
    const l = new PageLayout();
    l.setSizes(Array.from({ length: 10_000 }, () => ({ width: 800, height: 1000 })));
    l.setZoom(0.5);
    const top = l.top(5000);
    const [a, b] = l.visibleRange(top + 1, top + 900);
    expect(a).toBe(5000);
    expect(b).toBe(5001);
    expect(l.indexAt(l.totalHeight() + 50)).toBe(9999);
  });

  it("updates offsets when a page size becomes known", () => {
    const l = new PageLayout();
    l.setSizes([{ width: 100, height: 100 }, { width: 100, height: 100 }, { width: 100, height: 100 }]);
    const t2 = l.top(2);
    expect(l.setSize(1, { width: 100, height: 300 })).toBe(true);
    expect(l.top(2)).toBe(t2 + 200);
    expect(l.setSize(1, { width: 100, height: 300 })).toBe(false);
  });
});

describe("render scale", () => {
  it("clamps huge bitmaps to the pixel cap", () => {
    const r = clampRenderScale(612, 792, 8, 16 * 1024 * 1024);
    expect(r.clamped).toBe(true);
    expect(612 * 792 * r.scale ** 2).toBeLessThanOrEqual(16 * 1024 * 1024 + 1);
    expect(clampRenderScale(612, 792, 1, 16e6).clamped).toBe(false);
  });

  it("zoom steps", () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(8, 1)).toBe(8);
  });
});

describe("device profile", () => {
  it("uses a conservative budget on iPhone and iPadOS", () => {
    const iphone = computeProfile({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 });
    const ipad = computeProfile({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 });
    const win = computeProfile({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", deviceMemory: 8 });
    expect(iphone.isIOS).toBe(true);
    expect(ipad.isIOS).toBe(true);
    expect(win.isIOS).toBe(false);
    expect(iphone.maxCanvasPixels).toBeLessThan(16_777_216); // WebKit hard limit
    expect(iphone.canvasBudgetPixels).toBeLessThan(win.canvasBudgetPixels);
  });
});

describe("RenderQueue", () => {
  it("runs highest priority first with bounded concurrency", async () => {
    const q = new RenderQueue(1);
    const order: string[] = [];
    const task = (k: string, p: number) => ({ key: k, priority: p, run: async () => void order.push(k) });
    q.schedule(task("far", 100));
    q.schedule(task("near", 1));
    q.schedule(task("mid", 50));
    await q.whenIdle();
    expect(order).toEqual(["near", "mid", "far"]);
  });

  it("cancels pages that left the viewport", async () => {
    const q = new RenderQueue(1);
    const ran: string[] = [];
    let release!: () => void;
    q.schedule({ key: "a", priority: 0, run: () => new Promise<void>((r) => (release = () => (ran.push("a"), r()))) });
    q.schedule({ key: "b", priority: 1, run: async () => void ran.push("b") });
    await Promise.resolve();
    await Promise.resolve();
    q.retain((k) => k === "a");
    release();
    await q.whenIdle();
    expect(ran).toEqual(["a"]);
  });
});

describe("WeightedLRU", () => {
  it("evicts least-recently-used entries over budget, sparing pinned ones", () => {
    const evicted: string[] = [];
    const lru = new WeightedLRU<number>(10, (k) => evicted.push(k));
    lru.set("a", 1, 4);
    lru.set("b", 2, 4);
    lru.get("a");
    lru.set("c", 3, 4);
    expect(evicted).toEqual(["b"]);
    lru.set("d", 4, 8, (k) => k === "a");
    expect(evicted).toContain("c");
    expect(lru.peek("a")).toBe(1);
  });
});

describe("viewport maths (matches PDF.js PageViewport)", () => {
  for (const rot of [0, 90, 180, 270]) {
    it(`round-trips points at ${rot} degrees`, () => {
      const v = makeView([0, 0, 612, 792], 1.5, rot);
      const [x, y] = v.toView(100, 200);
      const [px, py] = v.toPdf(x, y);
      expect(px).toBeCloseTo(100);
      expect(py).toBeCloseTo(200);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(v.width);
      expect(y).toBeLessThanOrEqual(v.height);
    });
  }
  it("puts the PDF origin at the bottom-left for unrotated pages", () => {
    const v = makeView([0, 0, 612, 792], 1, 0);
    expect(v.toView(0, 0)).toEqual([0, 792]);
    const r = makeView([0, 0, 612, 792], 1, 90);
    expect(r.width).toBe(792);
    expect(r.toView(0, 0)).toEqual([0, 0]);
  });
});
