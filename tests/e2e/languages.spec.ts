import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from "pdf-lib";
import { fixture, openPdf, pageBox, saveAndRead } from "./helpers";

/** Thai, Chinese and English: display, search (including across pieces and lines), typing, saving. */
const hasThai = JSON.parse(readFileSync(fixture("languages.json"), "utf8")).thai as boolean;

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

async function search(page: Page, q: string) {
  await page.keyboard.press("Control+f");
  await page.fill(".pane.active .search-input", q);
  return page.locator(".pane.active .search-count");
}

test("finds English, Chinese and Thai words, also across lines", async ({ page }) => {
  await openPdf(page, "languages.pdf");
  await expect(await search(page, "hello world")).toHaveText("1 of 1");
  await expect(await search(page, "你好")).toHaveText("1 of 1");
  await expect(await search(page, "世界和平")).toHaveText("1 of 1"); // wraps onto the next line
  await expect(page.locator(".search-hit").first()).toBeAttached();
  if (hasThai) {
    await expect(await search(page, "สวัสดี")).toHaveText("1 of 1");
    await expect(await search(page, "อ่านได้")).toHaveText("1 of 1");
  }
});

test("Chinese and Thai text can be selected and copied", async ({ page }) => {
  await openPdf(page, "languages.pdf");
  await expect(page.locator(".textLayer span").first()).toBeAttached();
  const txt = await page.locator(".page").first().locator(".textLayer").innerText();
  expect(txt).toContain("中文测试");
  if (hasThai) expect(txt).toContain("ภาษาไทย");
});

test("typing Thai and Chinese into a text box saves correctly", async ({ page }) => {
  await openPdf(page, "languages.pdf");
  const b = await pageBox(page, 1);
  await page.keyboard.press("t");
  await page.mouse.click(b.x + 120, b.y + 600);
  await expect(page.locator("textarea.text-editor")).toBeFocused();
  await page.keyboard.insertText("ตรวจแล้ว 已审核 OK");
  await page.keyboard.press("Escape");
  await expect(page.locator(".annot-layer text").first()).toHaveText("ตรวจแล้ว 已审核 OK");
  const bytes = await saveAndRead(page);
  // Non-Latin typed text is rendered with system fonts into an image on the page.
  const doc = await PDFDocument.load(bytes);
  const xobjects = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const images = (xobjects?.entries() ?? []).filter(([, ref]) => {
    const s = doc.context.lookup(ref);
    return s instanceof PDFRawStream && s.dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
  });
  expect(images.length).toBeGreaterThan(0);
});
