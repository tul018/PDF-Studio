import { expect, test } from "@playwright/test";
import { openPdf, pageBox } from "./helpers";

test("arrow: frame covers the heads, ends drag, heads and size in the bar", async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("l");
  // The Line tool shows its heads in the properties bar.
  await expect(page.locator(".props-bar .opt-arrow")).toBeVisible();
  await page.mouse.move(b.x + 100, b.y + 400);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 400, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.mouse.click(b.x + 200, b.y + 400);
  const frame = (await page.locator(".selection-box").boundingBox())!;
  const head = (await page.locator(".annot polyline").last().boundingBox())!;
  expect(frame.x + frame.width).toBeGreaterThanOrEqual(head.x + head.width - 1);
  expect(frame.y).toBeLessThanOrEqual(head.y + 1);

  // Drag the end handle further right: the arrow gets longer.
  const ends = page.locator(".end-handle");
  await expect(ends).toHaveCount(2);
  const e2 = (await ends.nth(1).boundingBox())!;
  await page.mouse.move(e2.x + e2.width / 2, e2.y + e2.height / 2);
  await page.mouse.down();
  await page.mouse.move(e2.x + 120, e2.y + e2.height / 2, { steps: 5 });
  await page.mouse.up();
  const line = page.locator(".annot line").first();
  const x2 = Number(await line.getAttribute("x2"));
  const x1 = Number(await line.getAttribute("x1"));
  expect(x2 - x1).toBeGreaterThan(200);

  // Both heads, large, from the bar.
  await page.locator("#opt-head-start").selectOption("closed");
  await page.locator("#opt-head-size").selectOption("2.4");
  await expect(page.locator(".annot polygon")).toHaveCount(1);
  const big = (await page.locator(".annot polygon").boundingBox())!;
  expect(big.height).toBeGreaterThan(20);
});

test("Shift snaps a line to 45° steps and draws a square box", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("l");
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 312, { steps: 5 }); // a little off level
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const line = page.locator(".annot line").first();
  expect(Number(await line.getAttribute("y1"))).toBeCloseTo(Number(await line.getAttribute("y2")), 3);

  await page.keyboard.press("r");
  await page.mouse.move(b.x + 100, b.y + 450);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(b.x + 260, b.y + 500, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const box = (await page.locator(".annot rect").last().boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
});
