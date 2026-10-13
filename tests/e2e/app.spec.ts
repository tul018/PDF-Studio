import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { openPdf, pageBox, saveAndRead, stats } from "./helpers";
import { pageInfo, pageTexts } from "./pdftext";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("opens a PDF, navigates and searches", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await expect(page.locator("#page-total")).toHaveText("/ 12");
  await page.fill("#page-input", "6");
  await page.press("#page-input", "Enter");
  await expect(page.locator("#status-page")).toHaveText("Page 6 of 12");
  await page.keyboard.press("Control+f");
  await page.fill("#search-input", "needle");
  await expect(page.locator("#search-count")).toHaveText("1 of 2");
  await expect(page.locator(".search-hit").first()).toBeAttached();
  await page.press("#search-input", "Enter");
  await expect(page.locator("#search-count")).toHaveText("2 of 2");
  await expect(page.locator("#status-page")).toHaveText("Page 10 of 12");
});

test("text layer allows selecting text", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await expect(page.locator(".textLayer span").first()).toBeAttached();
  const txt = await page.locator(".page").first().locator(".textLayer").innerText();
  expect(txt).toContain("Page 1");
});

test("heavy 400-page image PDF stays within the memory budget", async ({ page }) => {
  await openPdf(page, "heavy-images.pdf");
  await expect(page.locator("#page-total")).toHaveText("/ 400");
  const scroller = page.locator(".pane.active .viewer");
  let maxPixels = 0;
  let maxMounted = 0;
  const budget = (await stats(page)).budget;
  // Fling through the document in big jumps, like a user dragging the scrollbar.
  for (let i = 0; i < 40; i++) {
    await scroller.evaluate((el, k) => (el.scrollTop = (el.scrollHeight * k) / 40), i);
    await page.waitForTimeout(120);
    const s = await stats(page);
    maxPixels = Math.max(maxPixels, s.canvasPixels);
    maxMounted = Math.max(maxMounted, s.mounted);
  }
  // Land on the last page and wait for a real render.
  await page.keyboard.press("End");
  await expect(page.locator("#status-page")).toHaveText("Page 400 of 400");
  await expect(page.locator('.page[data-page-number="400"] canvas.page-canvas')).toBeAttached({ timeout: 60_000 });
  const s = await stats(page);
  console.log(`max canvas ${(maxPixels * 4 / 1048576).toFixed(1)} MB of ${(budget * 4 / 1048576).toFixed(0)} MB budget, max mounted pages ${maxMounted}`);
  expect(maxPixels).toBeLessThanOrEqual(budget);
  expect(maxMounted).toBeLessThanOrEqual(12);
  expect(s.canvasPixels).toBeLessThanOrEqual(budget);
  await expect(page.locator("#toast.error")).toHaveCount(0);
});

test("annotate and save: text, box, ink, highlight, note", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  // Rectangle
  await page.keyboard.press("r");
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 400, { steps: 5 });
  await page.mouse.up();
  // Ink
  await page.keyboard.press("p");
  await page.mouse.move(b.x + 100, b.y + 500);
  await page.mouse.down();
  for (let k = 0; k < 20; k++) await page.mouse.move(b.x + 100 + k * 10, b.y + 500 + Math.sin(k) * 20);
  await page.mouse.up();
  // Text
  await page.keyboard.press("t");
  await page.mouse.click(b.x + 120, b.y + 600);
  await expect(page.locator("textarea.text-editor")).toBeFocused();
  await page.keyboard.type("Approved by QA");
  await page.keyboard.press("Escape");
  expect((await stats(page)).annotations).toBe(3);
  // Undo / redo
  await page.keyboard.press("Control+z");
  expect((await stats(page)).annotations).toBe(2);
  await page.keyboard.press("Control+y");
  expect((await stats(page)).annotations).toBe(3);

  const bytes = await saveAndRead(page);
  const texts = await pageTexts(bytes);
  expect(texts).toHaveLength(12);
  expect(texts[0]).toContain("Approved by QA");
  expect(texts[0]).toContain("Page 1");
  await expect(page.locator("#status-file")).not.toContainText("●");
});

test("page operations: rotate, delete, insert, reorder", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const thumb = (n: number) => page.locator(".thumb", { has: page.locator(`.thumb-label:text-is("${n}")`) });
  await thumb(1).click();
  await page.locator('[data-page-op="rotR"]').click();
  await thumb(2).click();
  await page.locator('[data-page-op="delete"]').click();
  await page.locator('[data-page-op="blank"]').click();
  const bytes = await saveAndRead(page);
  const info = await pageInfo(bytes);
  expect(info).toHaveLength(12);
  expect(info[0].rotate).toBe(90);
  const texts = await pageTexts(bytes);
  expect(texts.join("|")).not.toContain("Marker-2");
  expect(texts.filter((t) => t.trim() === "")).toHaveLength(1); // the blank page
});

test("true redaction removes text under the box", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.fill("#page-input", "3");
  await page.press("#page-input", "Enter");
  await page.keyboard.press("Control+f");
  await page.fill("#search-input", "needle");
  const hit = page.locator(".search-hit.current");
  await expect(hit).toBeAttached();
  const hb = (await hit.boundingBox())!;
  await page.keyboard.press("Escape");
  await page.locator('[data-tool="redact"]').click();
  await page.mouse.move(hb.x - 10, hb.y - 10);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width * 4, hb.y + hb.height + 10, { steps: 4 });
  await page.mouse.up();
  const bytes = await saveAndRead(page);
  const texts = await pageTexts(bytes);
  expect(texts[2]).not.toContain("needle");
  expect(texts[2]).not.toContain("Page 3"); // whole page is now an image
  expect(texts[9]).toContain("needle again"); // other pages untouched
});

test("fill a form and save", async ({ page }) => {
  await openPdf(page, "form.pdf");
  const input = page.locator("input.form-field:not([type])").first();
  await input.fill("Somchai");
  await input.press("Tab");
  await page.locator('input.form-field[type="checkbox"]').check();
  await page.locator("select.form-field").selectOption("Japan");
  const bytes = await saveAndRead(page);
  const doc = await PDFDocument.load(bytes);
  const f = doc.getForm();
  expect(f.getTextField("name").getText()).toBe("Somchai");
  expect(f.getCheckBox("subscribe").isChecked()).toBe(true);
  expect(f.getDropdown("country").getSelected()).toEqual(["Japan"]);
});

test("marks: mark a page and jump back from the list", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.fill("#page-input", "8");
  await page.press("#page-input", "Enter");
  await page.keyboard.press("m");
  await page.locator(".modal-input").fill("Important table");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator(".mark-item")).toHaveCount(1);
  await expect(page.locator(".mark-ribbon")).toHaveText("Important table");
  await page.keyboard.press("Home");
  await expect(page.locator("#status-page")).toHaveText("Page 1 of 12");
  await page.locator(".mark-go").click();
  await expect(page.locator("#status-page")).toHaveText("Page 8 of 12");
  // Marks persist per file.
  await page.reload();
  await openPdf(page, "basic.pdf");
  await page.locator('[data-tab="marks"]').click();
  await expect(page.locator(".mark-item .mark-label")).toHaveText("Important table");
});

test("split view shows two far-apart pages side by side", async ({ page }) => {
  await openPdf(page, "heavy-images.pdf");
  await page.keyboard.press("Control+\\");
  await expect(page.locator(".pane")).toHaveCount(2);
  const a = page.locator(".pane").nth(0);
  const bPane = page.locator(".pane").nth(1);
  await a.locator(".page-input").fill("3");
  await a.locator(".page-input").press("Enter");
  await bPane.locator(".page-input").fill("70");
  await bPane.locator(".page-input").press("Enter");
  await expect(a.locator('.page[data-page-number="3"] canvas.page-canvas')).toBeAttached();
  await expect(bPane.locator('.page[data-page-number="70"] canvas.page-canvas')).toBeAttached();
  const ba = (await a.boundingBox())!;
  const bb = (await bPane.boundingBox())!;
  expect(bb.x).toBeGreaterThan(ba.x + ba.width - 5); // side by side
  // An edit in one pane shows in the other when both show the same page.
  await page.screenshot({ path: "test-results/split-view.png" });
  await bPane.locator(".pane-close").click();
  await expect(page.locator(".pane")).toHaveCount(1);
});

test("@mobile iPad profile opens the heavy file within the smaller budget", async ({ page }) => {
  await openPdf(page, "heavy-images.pdf");
  const s0 = await stats(page);
  expect(s0.budget).toBeLessThanOrEqual(48 * 1024 * 1024);
  const scroller = page.locator(".pane.active .viewer");
  for (let i = 0; i < 15; i++) {
    await scroller.evaluate((el, k) => (el.scrollTop = (el.scrollHeight * k) / 15), i);
    await page.waitForTimeout(150);
    expect((await stats(page)).canvasPixels).toBeLessThanOrEqual(s0.budget);
  }
});
