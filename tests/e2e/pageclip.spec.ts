import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { cmd, openPdf, pageBox, saveAndRead } from "./helpers";
import { pageTexts } from "./pdftext";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

const thumb = (page: import("@playwright/test").Page, n: number) =>
  page.locator(".thumb", { has: page.locator(`.thumb-label:text-is("${n}")`) });

test("copy, cut and paste pages", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await thumb(page, 2).click();
  await page.keyboard.press("Control+c");
  await page.fill("#page-input", "5");
  await page.press("#page-input", "Enter");
  await page.locator(".pane.active .viewer").click({ position: { x: 5, y: 200 } });
  await page.keyboard.press("Control+v");
  await expect(page.locator("#page-total")).toHaveText("/ 13");
  await page.fill("#page-input", "1");
  await page.press("#page-input", "Enter");
  await thumb(page, 1).click();
  await page.keyboard.press("Control+x");
  await expect(page.locator("#page-total")).toHaveText("/ 12");
  const texts = await pageTexts(await saveAndRead(page));
  expect(texts[0]).toContain("Marker-2"); // page 1 cut away
  // Pasted after page 5 (6th); with page 1 cut away it is the 5th.
  expect(texts.map((t, i) => (t.includes("Marker-2") ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4]);
});

test("crop by dragging a frame", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await cmd(page, '[data-action="cropTool"]');
  const b = await pageBox(page, 1);
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "This page" }).click();
  const doc = await PDFDocument.load(await saveAndRead(page));
  const box = doc.getPage(0).getMediaBox();
  expect(box.width).toBeLessThan(330);
  expect(box.width).toBeGreaterThan(280); // about half of 612
  expect(Math.round(doc.getPage(1).getMediaBox().width)).toBe(612);
});
