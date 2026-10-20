import { expect, test } from "@playwright/test";
import { cmd, fixture, openPdf, pageBox } from "./helpers";

/** Change things after they're placed: fill and outline, a picture swapped in place, a comment's text. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("box: fill and outline changed after drawing; picture replaced in place; comment edited", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("r");
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 260, b.y + 380, { steps: 4 });
  await page.mouse.up();
  // Select it: the strip offers Fill; turn it on and drop the outline.
  await page.keyboard.press("v");
  await page.mouse.click(b.x + 102, b.y + 302);
  await expect(page.locator(".opt-fill")).toBeVisible();
  await page.locator("#opt-fill-on").check();
  await page.locator("#opt-width").selectOption("0");
  const rect = page.locator(".annot rect").first();
  await expect(rect).toHaveAttribute("fill", "#ffeb3b");
  await expect(rect).toHaveAttribute("stroke-width", "0");

  // A picture, then Replace… with another: same centre and width.
  const pick = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="image"]');
  await (await pick).setFiles(fixture("seal.png"));
  const img = page.locator(".annot image");
  const before = (await img.boundingBox())!;
  await expect(page.locator('.props-bar [data-action="replaceImage"]')).toBeVisible();
  await page.locator('.props-bar [data-action="replaceImage"]').click();
  const pick2 = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Picture from file…" }).click();
  await (await pick2).setFiles(fixture("seal.png"));
  await expect.poll(async () => (await img.getAttribute("href")) ?? "").not.toBe("");
  const after = (await img.boundingBox())!;
  expect(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2))).toBeLessThan(2);
  expect(Math.abs(after.width - before.width)).toBeLessThan(2);

  // A comment: select it, Edit comment.
  await page.keyboard.press("n");
  await page.mouse.click(b.x + 400, b.y + 500);
  await page.locator(".modal-input").fill("First");
  await page.locator(".modal .btn.primary").click();
  await page.keyboard.press("v");
  const note = (await page.locator(".annot.note").boundingBox())!;
  await page.mouse.click(note.x + note.width / 2, note.y + note.height / 3);
  await page.locator('.props-bar [data-action="editNote"]').click();
  await page.locator(".modal-input").fill("Second");
  await page.locator(".modal .btn.primary").click();
  await page.mouse.move(note.x + note.width / 2, note.y + note.height / 3 + 1);
  await expect(page.locator(".note-pop")).toContainText("Second");
});

test("Select: a click on empty space clears the selection", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("r");
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 250, b.y + 380, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.mouse.click(b.x + 101, b.y + 301);
  await expect(page.locator(".selection-box")).toHaveCount(1);
  await page.mouse.click(b.x + 400, b.y + 600); // empty part of the page
  await expect(page.locator(".selection-box")).toHaveCount(0);
  await page.mouse.click(b.x + 101, b.y + 301);
  await expect(page.locator(".selection-box")).toHaveCount(1);
  await page.mouse.click(b.x - 30, b.y + 300); // grey area beside the page
  await expect(page.locator(".selection-box")).toHaveCount(0);
});

test("drawing tool: a plain click on empty space goes back to Select", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("r");
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 250, b.y + 380, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.quick-tools [data-tool="rect"]')).toHaveClass(/\bon\b/); // still drawing boxes
  await page.mouse.click(b.x + 400, b.y + 600);
  await expect(page.locator('.quick-tools [data-tool="select"]')).toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => document.body.dataset.activeTool)).toBe("select");
});

test("Select: a drag on an empty spot drags the document at once; on text it selects", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  const scroller = page.locator(".pane.active .viewer");
  const top0 = await scroller.evaluate((el) => el.scrollTop);
  // Empty part of the page, a fast drag: pans.
  await page.mouse.move(b.x + 300, b.y + 500);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 300, { steps: 2 });
  await page.mouse.up();
  const top1 = await scroller.evaluate((el) => el.scrollTop);
  expect(top1 - top0).toBeGreaterThan(150);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  // On text: no pan (the drag selects text).
  const span = (await page.locator(".pane.active .textLayer span", { hasText: "quick brown" }).first().boundingBox())!;
  await page.mouse.move(span.x + 2, span.y + span.height / 2);
  await page.mouse.down();
  await page.mouse.move(span.x + span.width - 2, span.y + span.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(top1);
});
