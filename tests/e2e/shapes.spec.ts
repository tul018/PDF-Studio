import { expect, test } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { openPdf, pageBox, saveAndRead, stats } from "./helpers";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("shapes (star with fill, hexagon) and a two-headed arrow; comment shows on hover", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(b.x + x1, b.y + y1);
    await page.mouse.down();
    await page.mouse.move(b.x + x2, b.y + y2, { steps: 4 });
    await page.mouse.up();
  };
  await page.locator('[data-tool-menu="shape"]').click();
  await page.locator(".shape-tile", { hasText: /^Star$/ }).click();
  await page.locator(".pop-choice button", { hasText: "Solid fill" }).click();
  await page.keyboard.press("Escape");
  await drag(60, 260, 160, 360);
  await expect(page.locator('.annot path[fill="#e53935"]')).toHaveCount(1);
  // Changing the menu restyles the selected shape: select it, pick Hexagon.
  await page.keyboard.press("v");
  await page.mouse.click(b.x + 110, b.y + 310);
  await page.locator('[data-tool-menu="shape"]').click();
  await page.locator(".shape-tile", { hasText: "Hexagon" }).click();
  await page.keyboard.press("Escape");
  const d = await page.locator(".annot path").first().getAttribute("d");
  expect(d!.match(/L/g)).toHaveLength(5); // 6 corners

  await page.locator('[data-tool-menu="arrow"]').click();
  await page.locator(".pop-choice button", { hasText: "Both heads" }).click();
  await page.keyboard.press("Escape");
  await drag(60, 420, 300, 420);
  expect((await stats(page)).annotations).toBe(2);

  await page.keyboard.press("n");
  await page.mouse.click(b.x + 350, b.y + 480);
  await page.locator(".modal-input").fill("Price?");
  await page.locator(".modal .btn.primary").click();
  const r = (await page.locator(".annot.note").boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 3);
  await expect(page.locator(".note-pop")).toContainText("Price?");

  // Saved as editable annotations: the arrow keeps both heads.
  await page.evaluate(() => localStorage.setItem("pdfstudio:nativeAnnotations", "1"));
  const doc = await PDFDocument.load(await saveAndRead(page));
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).asArray().map((x) => doc.context.lookup(x) as PDFDict);
  const line = annots.find((a) => a.get(PDFName.of("Subtype"))?.toString() === "/Line")!;
  expect(line.lookup(PDFName.of("LE"), PDFArray).asArray().map(String)).toEqual(["/OpenArrow", "/OpenArrow"]);
});
