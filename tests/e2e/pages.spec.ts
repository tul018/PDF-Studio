import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName, type PDFString } from "pdf-lib";
import { cmd, fixture, openPdf } from "./helpers";
import { pageTexts } from "./pdftext";

/** Extract / split by ranges, export by range, merge PDFs, move pages to a typed position. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

const srcOrder = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { app: { history: { state: { pages: { srcIndex: number }[] } } } }).app.history.state.pages.map((p) => p.srcIndex + 1),
  );

test("extract a page range into one PDF", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.pageops [data-page-op="extract"]').click();
  const modal = page.locator(".modal");
  await expect(modal.locator("select").first()).toHaveValue("one");
  await modal.locator(".modal-input").fill("2-4, 9");
  await expect(modal.locator("p.muted.small")).toHaveText("1 file with 4 pages.");
  const dl = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Save…", exact: true }).click();
  const bytes = new Uint8Array(readFileSync((await (await dl).path())!));
  const texts = await pageTexts(bytes);
  expect(texts).toHaveLength(4);
  expect(texts.map((t) => /Page (\d+)/.exec(t)![1])).toEqual(["2", "3", "4", "9"]);
});

test("export images for a typed page range; bad ranges are explained", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.pageops [data-page-op="exportImages"]').click();
  const modal = page.locator(".modal");
  await modal.locator("select").first().selectOption("range");
  await modal.locator(".modal-input").fill("5-30");
  await expect(modal.locator(".error-text")).toContainText("outside pages 1-12");
  await modal.locator(".modal-input").fill("5-6");
  const names: string[] = [];
  const done = new Promise<void>((resolve) =>
    page.on("download", (d) => {
      names.push(d.suggestedFilename());
      if (names.length === 2) resolve();
    }),
  );
  await modal.getByRole("button", { name: "Export", exact: true }).click();
  await done;
  expect(names.sort()).toEqual(["basic p05.png", "basic p06.png"]);
});

test("merge PDFs: choose order, one new PDF opens", async ({ page }) => {
  const chooser = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="mergeFiles"]');
  await (await chooser).setFiles([fixture("basic.pdf"), fixture("form.pdf")]);
  const modal = page.locator(".modal");
  await expect(modal.locator(".merge-list li")).toHaveCount(2);
  // Put form.pdf first.
  await modal.locator(".merge-list li").nth(1).getByRole("button", { name: "Move up" }).click();
  await expect(modal.locator(".merge-name").first()).toHaveText("form.pdf");
  await modal.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.locator("body.has-doc")).toBeVisible();
  const formPages = (await PDFDocument.load(readFileSync(fixture("form.pdf")))).getPageCount();
  await expect(page.locator("#page-total")).toHaveText(`/ ${formPages + 12}`);
  // Each original file is a bookmark section, in the merged order.
  await page.locator('[data-tab="outline"]').click();
  const top = page.locator('[data-panel="outline"] .outline-link');
  await expect(top.first()).toHaveText("form");
  await expect(top.filter({ hasText: /^basic$/ })).toHaveCount(1);
});

test("saving pages added from another PDF keeps a bookmark per file", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const chooser = page.waitForEvent("filechooser");
  await page.locator('.pageops [data-page-op="merge"]').click();
  await (await chooser).setFiles(fixture("form.pdf"));
  await expect(page.locator("#page-total")).not.toHaveText("/ 12");
  const dl = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const doc = await PDFDocument.load(readFileSync((await (await dl).path())!));
  const titles: string[] = [];
  let cur = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  while (cur) {
    titles.push((cur.lookup(PDFName.of("Title")) as PDFString).decodeText());
    cur = cur.lookupMaybe(PDFName.of("Next"), PDFDict)!;
  }
  expect(titles).toEqual(["basic", "form"]);
});

test("move the current page to a typed page number", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.pageops [data-page-op="moveTo"]').click();
  await page.locator(".modal .modal-input").fill("10");
  await page.locator(".modal").getByRole("button", { name: "Move", exact: true }).click();
  expect(await srcOrder(page)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 11, 12]);
  await page.keyboard.press("Control+z");
  expect(await srcOrder(page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});
