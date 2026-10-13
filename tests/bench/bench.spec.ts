import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { openPdf } from "../e2e/helpers";

/**
 * Performance benchmark (not part of `npm run e2e`): `npm run bench`.
 * Set BENCH_CPU=4 to emulate a 4x slower CPU (typical laptop / tablet).
 * Results are printed and written to bench-results/<label>.json.
 */
const CPU = Number(process.env.BENCH_CPU ?? 1);
const LABEL = process.env.BENCH_LABEL ?? "run";
const results: Record<string, number> = {};

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  if (CPU > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  }
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test.afterAll(() => {
  mkdirSync("bench-results", { recursive: true });
  writeFileSync(`bench-results/${LABEL}-cpu${CPU}.json`, JSON.stringify(results, null, 2));
  console.log(`\n=== ${LABEL} (CPU x${CPU}) ===`);
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(34)} ${v.toFixed(k.endsWith("%") ? 1 : 0)}`);
});

const sharp = (n: number) => `.pane.active .page[data-page-number="${n}"]:not(.loading) canvas.page-canvas`;

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t = Date.now();
  await fn();
  return Date.now() - t;
}

async function openTimed(page: Page, name: string): Promise<number> {
  return timed(async () => {
    await openPdf(page, name);
    await page.locator(sharp(1)).first().waitFor({ timeout: 120_000 });
  });
}

/** Jump to each page and wait until it is rendered (not just mounted). */
async function jumps(page: Page, targets: number[]): Promise<number> {
  let total = 0;
  for (const n of targets) {
    total += await timed(async () => {
      await page.fill("#page-input", String(n));
      await page.press("#page-input", "Enter");
      await page.locator(sharp(n)).first().waitFor({ timeout: 120_000 });
    });
  }
  return total / targets.length;
}

/**
 * Scroll at a steady `pxPerFrame` for `frames` animation frames (a fast
 * wheel/trackpad fling) and record frame times, how often the page in the
 * middle of the screen is still blank, and main-thread long tasks.
 */
async function fling(page: Page, pxPerFrame: number, frames: number) {
  return page.evaluate(
    ({ pxPerFrame, frames }) =>
      new Promise<{ avg: number; p95: number; jank: number; blank: number; longTasks: number }>((resolve) => {
        const el = document.querySelector<HTMLElement>(".pane.active .viewer")!;
        let longTasks = 0;
        const obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) longTasks += e.duration;
        });
        obs.observe({ type: "longtask", buffered: false });
        const dts: number[] = [];
        let blank = 0;
        let last = performance.now();
        let k = 0;
        const step = (now: number) => {
          dts.push(now - last);
          last = now;
          const mid = el.getBoundingClientRect().top + el.clientHeight / 2;
          const hit = document.elementsFromPoint(el.getBoundingClientRect().left + el.clientWidth / 2, mid);
          const pageEl = hit.find((n) => n.classList?.contains("page"));
          if (!pageEl || pageEl.classList.contains("loading")) blank++;
          if (++k >= frames) {
            obs.disconnect();
            const s = dts.slice(1).sort((a, b) => a - b);
            resolve({
              avg: s.reduce((a, b) => a + b, 0) / s.length,
              p95: s[Math.floor(s.length * 0.95)],
              jank: (s.filter((d) => d > 34).length / s.length) * 100,
              blank: (blank / frames) * 100,
              longTasks,
            });
            return;
          }
          el.scrollTop += pxPerFrame;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { pxPerFrame, frames },
  );
}

/** A hard flick (~12 000 px/s): pages fly by faster than they can be drawn. */
async function fastFling(page: Page, k: string): Promise<void> {
  const f = await fling(page, 200, 180);
  results[`${k}: FAST fling p95 frame (ms)`] = f.p95;
  results[`${k}: FAST fling janky frames %`] = f.jank;
  results[`${k}: FAST fling blank-centre frames %`] = f.blank;
  results[`${k}: FAST fling long tasks (ms)`] = f.longTasks;
  results[`${k}: after FAST fling -> sharp+text (ms)`] = await settle(page);
}

async function settle(page: Page): Promise<number> {
  return timed(() =>
    page.waitForFunction(() => {
      const el = document.querySelector<HTMLElement>(".pane.active .viewer")!;
      const r = el.getBoundingClientRect();
      const visible = [...el.querySelectorAll<HTMLElement>(".page")].filter((p) => {
        const b = p.getBoundingClientRect();
        return b.bottom > r.top && b.top < r.bottom;
      });
      return visible.length > 0 && visible.every((p) => !p.classList.contains("loading") && p.querySelector(".textLayer span"));
    }, undefined, { timeout: 120_000, polling: 16 }),
  );
}

async function heap(page: Page): Promise<number> {
  return page.evaluate(() => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576);
}

test("startup", async ({ page }) => {
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return nav.loadEventEnd;
  });
  results["startup: page loaded (ms)"] = t;
});

test("long text document (2000 pages)", async ({ page }) => {
  results["text: open -> page 1 sharp (ms)"] = await openTimed(page, "long-text.pdf");
  results["text: jump -> page sharp (ms)"] = await jumps(page, [500, 1200, 1999, 40]);
  await page.fill("#page-input", "100");
  await page.press("#page-input", "Enter");
  await page.locator(sharp(100)).first().waitFor();
  const f = await fling(page, 60, 240);
  results["text: fling avg frame (ms)"] = f.avg;
  results["text: fling p95 frame (ms)"] = f.p95;
  results["text: fling janky frames %"] = f.jank;
  results["text: fling blank-centre frames %"] = f.blank;
  results["text: fling long tasks (ms)"] = f.longTasks;
  results["text: after fling -> sharp+text (ms)"] = await settle(page);
  await fastFling(page, "text");
  await page.keyboard.press("Control+f");
  results["text: search 2000 pages (ms)"] = await timed(async () => {
    await page.fill(".pane.active .search-input", "zebra");
    await expect(page.locator(".pane.active .search-count")).toHaveText("1 of 1", { timeout: 120_000 });
  });
  results["text: JS heap after (MB)"] = await heap(page);
});

test("heavy image document (400 pages, 261 MB)", async ({ page }) => {
  results["heavy: open -> page 1 sharp (ms)"] = await openTimed(page, "heavy-images.pdf");
  results["heavy: jump -> page sharp (ms)"] = await jumps(page, [150, 300, 399, 20]);
  const f = await fling(page, 60, 240);
  results["heavy: fling avg frame (ms)"] = f.avg;
  results["heavy: fling p95 frame (ms)"] = f.p95;
  results["heavy: fling janky frames %"] = f.jank;
  results["heavy: fling blank-centre frames %"] = f.blank;
  results["heavy: fling long tasks (ms)"] = f.longTasks;
  results["heavy: after fling -> sharp+text (ms)"] = await settle(page);
  await fastFling(page, "heavy");
  results["heavy: JS heap after (MB)"] = await heap(page);
});

test("save", async ({ page }) => {
  await openPdf(page, "long-text.pdf");
  const thumb = page.locator(".thumb", { has: page.locator('.thumb-label:text-is("1")') });
  await thumb.click();
  await page.locator('[data-page-op="delete"]').click();
  results["save: text, page deleted (ms)"] = await timed(async () => {
    const dl = page.waitForEvent("download", { timeout: 240_000 });
    await page.keyboard.press("Control+s");
    await dl;
  });
  await page.goto("/");
  await openPdf(page, "heavy-images.pdf");
  await page.locator(".thumb", { has: page.locator('.thumb-label:text-is("1")') }).click();
  await page.locator('[data-page-op="rotR"]').click();
  results["save: heavy, page rotated (ms)"] = await timed(async () => {
    const dl = page.waitForEvent("download", { timeout: 240_000 });
    await page.keyboard.press("Control+s");
    await dl;
  });
});
