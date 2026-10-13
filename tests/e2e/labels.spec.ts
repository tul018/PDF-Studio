import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { openPdf } from "./helpers";

/** Label printing mode: Shopee half-page labels onto 82.6 x 49.8 mm stock. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

const mm = (pt: number) => Math.round(((pt * 25.4) / 72) * 10) / 10;

test("save a label PDF: one label per page, label-stock sized", async ({ page }) => {
  await openPdf(page, "shopee-labels.pdf");
  await page.locator('[data-action="labels"]').click();
  await expect(page.locator(".label-dialog")).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save label PDF" }).click();
  const file = await (await dl).path();
  const doc = await PDFDocument.load(readFileSync(file!));
  expect(doc.getPageCount()).toBe(5); // 3 A4 pages, the last bottom half empty
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    expect([mm(width), mm(height)]).toEqual([82.6, 49.8]);
  }
  await expect(page.locator("#toast")).toContainText("Saved 5 labels");
});

test("print: each label rendered at the printer's 203 dpi on stock-sized paper; settings remembered", async ({ page }) => {
  await openPdf(page, "shopee-labels.pdf");
  // Capture what would be printed instead of opening the system print dialog.
  await page.evaluate(() => {
    (window as unknown as { __printed: unknown }).__printed = null;
    window.print = () => {
      const imgs = [...document.querySelectorAll<HTMLImageElement>("#print-root img")];
      const css = [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("\n");
      (window as unknown as { __printed: unknown }).__printed = {
        count: imgs.length,
        sizes: imgs.map((i) => [i.naturalWidth, i.naturalHeight]),
        png: imgs.every((i) => i.src.startsWith("blob:")),
        pageCss: /@page \{ size: 100mm 150mm; margin: 0; \}/.test(css),
      };
    };
  });
  await page.locator('[data-action="labels"]').click();
  // A different stock this time: 100 x 150 mm (labels get turned to fit).
  await page.locator(".label-dialog select").nth(1).selectOption("100x150");
  await page.getByRole("button", { name: "Print labels" }).click();
  await expect(page.locator("#toast")).toContainText("5 labels sent to the printer");
  const printed = await page.evaluate(() => (window as unknown as { __printed: { count: number; sizes: number[][]; pageCss: boolean } }).__printed);
  expect(printed.count).toBe(5);
  expect(printed.pageCss).toBe(true);
  // 100 x 150 mm at 203 dpi = 799 x 1199 dots.
  for (const [w, h] of printed.sizes) {
    expect(Math.abs(w - 799)).toBeLessThanOrEqual(1);
    expect(Math.abs(h - 1199)).toBeLessThanOrEqual(1);
  }
  // Remembered next time.
  await page.locator('[data-action="labels"]').click();
  await expect(page.locator(".label-dialog select").nth(1)).toHaveValue("100x150");
});
