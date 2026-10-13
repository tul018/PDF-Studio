import { test } from "@playwright/test";
import { openPdf } from "../e2e/helpers";

/** CPU-profile the main thread during a fling; print top functions by self time. */
for (const file of ["long-text.pdf", "heavy-images.pdf"]) {
  test(`profile ${file}`, async ({ page }) => {
    test.setTimeout(300_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.BENCH_CPU ?? 4) });
    await page.goto("/");
    await openPdf(page, file);
    await page.waitForTimeout(1500);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
    await page.evaluate(() => new Promise<void>((res) => {
      const el = document.querySelector<HTMLElement>(".pane.active .viewer")!;
      let k = 0;
      const step = () => { el.scrollTop += 60; if (++k < 240) requestAnimationFrame(step); else setTimeout(res, 1500); };
      requestAnimationFrame(step);
    }));
    const { profile } = (await cdp.send("Profiler.stop")) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] } };
    const self = new Map<number, number>();
    profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    const byFn = new Map<string, number>();
    let total = 0;
    for (const n of profile.nodes) {
      const t = (self.get(n.id) ?? 0) / 1000;
      total += t;
      const cf = n.callFrame;
      const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber}`;
      byFn.set(key, (byFn.get(key) ?? 0) + t);
    }
    const top = [...byFn].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).sort((a, b) => b[1] - a[1]).slice(0, 18);
    console.log(`\n--- ${file}: total sampled ${total.toFixed(0)} ms (idle ${(byFn.get("(idle) :-1") ?? 0).toFixed(0)}, program ${(byFn.get("(program) :-1") ?? 0).toFixed(0)}, gc ${(byFn.get("(garbage collector) :-1") ?? 0).toFixed(0)})`);
    for (const [k, v] of top) console.log(`${v.toFixed(0).padStart(6)} ms  ${k}`);
  });
}
