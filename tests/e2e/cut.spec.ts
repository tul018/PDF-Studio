import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { openPdf, saveAndRead } from "./helpers";

/** Cut pages: vertical and horizontal cuts by percentage, on the current or selected pages. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("cut the current page into 4 (both cuts), save, undo", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.pageops [data-page-op="cut"]').click();
  const dlg = page.locator(".cut-dialog");
  await expect(dlg.locator("canvas")).toBeVisible();
  await dlg.getByLabel("Horizontal cut at").check();
  await expect(dlg.locator("p.muted.small")).toContainText("1 page → 4 pages");
  await dlg.getByRole("button", { name: "Cut", exact: true }).click();
  await expect(page.locator("#page-total")).toHaveText("/ 15");
  await expect(page.locator(".pane.active .page[data-page-number='1'] canvas.page-canvas")).toBeAttached();

  const doc = await PDFDocument.load(await saveAndRead(page));
  expect(doc.getPageCount()).toBe(15);
  const sizes = doc.getPages().slice(0, 4).map((p) => {
    const b = p.getMediaBox();
    return [b.x, b.y, b.width, b.height].map((n) => Math.round(n));
  });
  // basic.pdf page 1 is 612 x 792: top-left, top-right, bottom-left, bottom-right.
  expect(sizes).toEqual([
    [0, 396, 306, 396],
    [306, 396, 306, 396],
    [0, 0, 306, 396],
    [306, 0, 306, 396],
  ]);
  expect(Math.round(doc.getPage(4).getMediaBox().width)).toBe(612); // page 2 untouched

  await page.keyboard.press("Control+z");
  await expect(page.locator("#page-total")).toHaveText("/ 12");
});

test("cut at 30% on the current page only; search counts only what a piece shows", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  // Page 3 has "needle" in its lower half; cut it horizontally at 50%.
  await page.fill("#page-input", "3");
  await page.press("#page-input", "Enter");
  await page.locator('.pageops [data-page-op="cut"]').click();
  const dlg = page.locator(".cut-dialog");
  await dlg.getByLabel("Vertical cut at").uncheck();
  await dlg.getByLabel("Horizontal cut at").check();
  await dlg.getByRole("button", { name: "Cut", exact: true }).click();
  await expect(page.locator("#page-total")).toHaveText("/ 13");
  await page.keyboard.press("Control+f");
  await page.fill(".pane.active .search-input", "needle");
  // Pages 3 (now its bottom piece, page 4) and 10 (now 11): 2 hits, not 3.
  await expect(page.locator(".pane.active .search-count")).toHaveText(/of 2$/);

  // A vertical cut at 30% of page 1.
  await page.fill("#page-input", "1");
  await page.press("#page-input", "Enter");
  await page.locator('.pageops [data-page-op="cut"]').click();
  await dlg.getByLabel("Horizontal cut at").uncheck();
  await dlg.getByLabel("Vertical cut at").check();
  await dlg.locator(".cut-row").first().locator(".num-input").fill("30");
  await dlg.getByRole("button", { name: "Cut", exact: true }).click();
  await expect(page.locator("#page-total")).toHaveText("/ 14");
  const doc = await PDFDocument.load(await saveAndRead(page));
  expect([doc.getPage(0).getMediaBox().width, doc.getPage(1).getMediaBox().width].map((n) => Math.round(n * 10) / 10)).toEqual([183.6, 428.4]);
});
