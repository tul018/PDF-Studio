import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { openPdf } from "./helpers";

/** Split into several PDF files, and export pages as images (browser: one download each). */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

async function collectDownloads(page: Page, n: number, act: () => Promise<void>) {
  const got: { name: string; bytes: Buffer }[] = [];
  const done = new Promise<void>((resolve) => {
    page.on("download", async (d) => {
      got.push({ name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) });
      if (got.length === n) resolve();
    });
  });
  await act();
  await done;
  return got.sort((a, b) => a.name.localeCompare(b.name));
}

test("split into files every 5 pages; bad ranges explained", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('[data-page-op="splitFiles"]').click();
  await page.locator(".modal select").selectOption("ranges");
  await page.locator(".modal-input").fill("1-3, 20-");
  await expect(page.locator(".modal .error-text")).toContainText("outside pages 1-12");
  await page.locator(".modal select").selectOption("every");
  await page.locator(".modal .num-input").fill("5");
  await expect(page.locator(".modal p.muted.small")).toHaveText("3 files: 1-5, 6-10, 11-12");
  const files = await collectDownloads(page, 3, () => page.locator(".modal").getByRole("button", { name: "Split", exact: true }).click());
  expect(files.map((f) => f.name)).toEqual(["basic p1-5.pdf", "basic p11-12.pdf", "basic p6-10.pdf"]);
  const counts = await Promise.all(files.map(async (f) => (await PDFDocument.load(f.bytes)).getPageCount()));
  expect(counts).toEqual([5, 2, 5]);
  await expect(page.locator("#toast")).toContainText("Saved 3 PDF files");
});

test("export the current page as PNG and all pages as JPG", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.fill("#page-input", "3");
  await page.press("#page-input", "Enter");
  await page.locator('[data-page-op="exportImages"]').click();
  const [png] = await collectDownloads(page, 1, () => page.locator(".modal").getByRole("button", { name: "Export", exact: true }).click());
  expect(png.name).toBe("basic p03.png");
  expect(png.bytes.subarray(1, 4).toString()).toBe("PNG");
  // 612 x 792 pt at 150 dpi = 1275 x 1650 px.
  expect([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)]).toEqual([1275, 1650]);

  await page.locator('[data-page-op="exportImages"]').click();
  await page.locator(".modal select").nth(0).selectOption("all");
  await page.locator(".modal select").nth(1).selectOption("jpeg");
  const jpgs = await collectDownloads(page, 12, () => page.locator(".modal").getByRole("button", { name: "Export", exact: true }).click());
  expect(jpgs.map((f) => f.name)[0]).toBe("basic p01.jpg");
  expect(jpgs.every((f) => f.bytes[0] === 0xff && f.bytes[1] === 0xd8)).toBe(true);
});
