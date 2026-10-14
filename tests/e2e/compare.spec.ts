import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fixture, openPdf } from "./helpers";

async function openOther(page: import("@playwright/test").Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".pane").nth(1).locator('[data-pane-act="other"]').click();
  await (await chooser).setFiles(file);
}

test("split view: pane B opens another PDF; differences marked, scrolling in sync", async ({ page }) => {
  // B: basic.pdf with one extra word on page 2.
  const doc = await PDFDocument.load(readFileSync(fixture("basic.pdf")));
  doc.getPage(1).drawText("CHANGED", { x: 72, y: 400, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const changed = join(tmpdir(), `pdfstudio-compare-${Date.now()}.pdf`);
  writeFileSync(changed, await doc.save());

  await page.goto("/");
  await openPdf(page, "basic.pdf");
  await page.keyboard.press("Control+\\");
  await openOther(page, fixture("basic.pdf"));
  const status = page.locator(".compare-status");
  await expect(status).toHaveText("No differences found");

  await page.locator(".compare-bar").getByRole("button", { name: "Back" }).click();
  await openOther(page, changed);
  await expect(status).toHaveText("1 of 12 pages differ");
  await expect(page.locator('.compare-viewer .page[data-page-number="2"] .diff-add rect').first()).toBeAttached();

  // Scrolling A moves B to the same page.
  await page.locator(".pane").nth(0).locator(".page-input").fill("8");
  await page.locator(".pane").nth(0).locator(".page-input").press("Enter");
  await expect(page.locator('.compare-viewer .page[data-page-number="8"]')).toBeInViewport();
});
