import { expect, test, type Page } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { fixture, openPdf, saveAndRead, stats } from "./helpers";
import { pageTexts } from "./pdftext";

/** Stamps, company seal, page numbers and watermark. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

const annots = async (page: Page) => (await stats(page)).annotations;

/** Image XObjects drawn on each page, and how many distinct image streams the file has. */
async function images(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const perPage = doc.getPages().map((p) => {
    const xo = p.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    return (xo?.entries() ?? []).filter(([, ref]) => {
      const s = doc.context.lookup(ref);
      return s instanceof PDFRawStream && s.dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
    }).length;
  });
  let streams = 0;
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") && !o.dict.get(PDFName.of("SMask"))) streams++;
  }
  return { perPage, streams };
}

test("stamp on this page, Thai stamp with date on every page, one undo removes them", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.tool-bar [data-action="stamp"]').click();
  await page.locator(".stamp-tile", { hasText: /^PAID$/ }).click();
  await expect.poll(() => annots(page)).toBe(1);

  await page.locator('.tool-bar [data-action="stamp"]').click();
  await page.getByLabel("Add today's date under text stamps").check();
  await page.getByLabel("Put it on every page (bottom right)").check();
  await page.locator(".stamp-tile", { hasText: "ได้รับเงินแล้ว" }).click();
  await expect.poll(() => annots(page)).toBe(13);
  await expect(page.locator("#toast")).toContainText("Stamp added to 12 pages");
  await page.keyboard.press("Control+z");
  await expect.poll(() => annots(page)).toBe(1);
  await page.keyboard.press("Control+y");

  const { perPage } = await images(await saveAndRead(page));
  expect(perPage[0]).toBe(2); // PAID + the all-pages stamp
  expect(perPage.slice(1).every((n) => n === 1)).toBe(true);
});

test("company seal image: placed, and saved for next time", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.tool-bar [data-action="stamp"]').click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".stamp-tile", { hasText: "Add seal / logo image" }).click();
  await (await chooser).setFiles(fixture("seal.png"));
  await expect.poll(() => annots(page)).toBe(1);
  // Next time it is in the list, with its white paper made transparent.
  await page.locator('.tool-bar [data-action="stamp"]').click();
  const saved = page.locator(".stamp-tile img");
  await expect(saved).toHaveCount(1);
  const alpha = await saved.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return [ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data[3], ctx.getImageData(2, c.height / 2, 1, 1).data[3]];
  });
  expect(alpha[0]).toBe(0); // the paper inside the ring: transparent
  expect(alpha[1]).toBeGreaterThan(200); // the ring (trimmed to its edge): opaque
  await page.locator(".stamp-del").click();
  await expect(saved).toHaveCount(0);
});

test("page numbers on every page; running again replaces them; remove", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.tool-bar [data-action="pageNumbers"]').click();
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await expect.poll(() => annots(page)).toBe(12);
  const texts = await pageTexts(await saveAndRead(page));
  texts.forEach((t, i) => expect(t).toContain(`Page ${i + 1} of 12`));

  await page.locator('.tool-bar [data-action="pageNumbers"]').click();
  await page.locator(".modal select").first().selectOption("หน้า {n}/{total}");
  await page.getByLabel("No number on the first page (cover)").check();
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await expect.poll(() => annots(page)).toBe(11); // replaced, not added

  await page.locator('.tool-bar [data-action="pageNumbers"]').click();
  await page.getByRole("button", { name: "Remove page numbers" }).click();
  await expect.poll(() => annots(page)).toBe(0);
});

test("watermark on every page, stored once in the file", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('.tool-bar [data-action="watermark"]').click();
  await page.locator(".modal-input").fill("สำเนา ห้ามเผยแพร่");
  await page.getByRole("button", { name: "Add watermark" }).click();
  await expect.poll(() => annots(page)).toBe(12);
  const { perPage, streams } = await images(await saveAndRead(page));
  expect(perPage.every((n) => n === 1)).toBe(true);
  expect(streams).toBe(1);
});
