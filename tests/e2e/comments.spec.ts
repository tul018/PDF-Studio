import { expect, test } from "@playwright/test";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString } from "pdf-lib";
import { openPdf, pageBox, saveAndRead, stats } from "./helpers";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("comments: name, reply, done, filter; saved as a PDF thread", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('[data-tab="comments"]').click();
  await page.locator(".comments-name").fill("Tul");
  await page.locator(".comments-name").press("Tab");
  const b = await pageBox(page, 1);
  await page.keyboard.press("n");
  await page.mouse.click(b.x + 200, b.y + 200);
  await page.locator(".modal-input").fill("Check the price");
  await page.locator(".modal .btn.primary").click();
  const item = page.locator(".comment-item");
  await expect(item).toHaveCount(1);
  await expect(item.locator(".comment-head")).toContainText("p. 1 · Tul");
  await item.getByRole("button", { name: "Reply" }).click();
  await page.locator(".modal-input").fill("Fixed");
  await page.locator(".modal .btn.primary").click();
  await expect(item.locator(".comment-reply")).toContainText("Fixed");
  await item.getByRole("button", { name: "Done" }).click();
  await page.locator('[data-filter="open"]').click();
  await expect(page.locator(".comment-item")).toHaveCount(0);
  await page.locator('[data-filter="done"]').click();
  await expect(page.locator(".comment-item")).toHaveCount(1);

  const doc = await PDFDocument.load(await saveAndRead(page));
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
  const dicts = annots.asArray().map((r) => doc.context.lookup(r) as PDFDict);
  const text = (d: PDFDict, k: string) => (d.lookup(PDFName.of(k)) as PDFHexString | undefined)?.decodeText();
  const parent = dicts.find((d) => text(d, "Contents") === "Check the price")!;
  expect(text(parent, "T")).toBe("Tul");
  const replies = dicts.filter((d) => d.has(PDFName.of("IRT")));
  expect(replies.map((d) => text(d, "Contents"))).toEqual(["Fixed", "Completed"]);
  expect(replies[1].lookup(PDFName.of("State"))?.toString()).toBe("/Completed");
});

test("cloud shape and eraser", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("c");
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 400, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".annot path")).toHaveCount(1);
  // Two pen strokes; the eraser crosses only the first.
  await page.keyboard.press("p");
  for (const y of [500, 600]) {
    await page.mouse.move(b.x + 100, b.y + y);
    await page.mouse.down();
    await page.mouse.move(b.x + 300, b.y + y, { steps: 6 });
    await page.mouse.up();
  }
  expect((await stats(page)).annotations).toBe(3);
  await page.keyboard.press("e");
  await page.mouse.move(b.x + 200, b.y + 470);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 530, { steps: 6 });
  await page.mouse.up();
  expect((await stats(page)).annotations).toBe(2);
  await page.keyboard.press("Control+z");
  expect((await stats(page)).annotations).toBe(3);
});

test("Comment tool: one click on a comment opens nothing; double-click edits it with its text", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("n");
  await page.mouse.click(b.x + 200, b.y + 200);
  await page.locator(".modal-input").fill("Original text");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator(".annot.note")).toHaveCount(1);
  const r = (await page.locator(".annot.note").boundingBox())!;
  const cx = r.x + r.width / 2,
    cy = r.y + r.height / 3;
  await page.mouse.click(cx, cy);
  await expect(page.locator(".modal")).toHaveCount(0);
  await page.mouse.dblclick(cx, cy);
  await expect(page.locator(".modal-input")).toHaveValue("Original text");
  await page.locator(".modal-input").fill("Changed");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator(".annot.note")).toHaveCount(1);
  await page.mouse.move(cx, cy + 1);
  await expect(page.locator(".note-pop")).toContainText("Changed");
});
