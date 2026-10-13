import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { readFileSync } from "node:fs";

export const fixture = (name: string) => join(process.cwd(), "tests", "fixtures", name);

export async function openPdf(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.locator('[data-action="open"]').first().click();
  await (await chooser).setFiles(fixture(name));
  await expect(page.locator("body.has-doc")).toBeVisible();
  await expect(page.locator(".page canvas.page-canvas").first()).toBeAttached();
}

export async function stats(page: Page) {
  return page.evaluate(() => (window as unknown as { __pdfstudio: Record<string, number> }).__pdfstudio);
}

export async function saveAndRead(page: Page): Promise<Uint8Array> {
  const dl = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const d = await dl;
  const path = await d.path();
  return new Uint8Array(readFileSync(path!));
}

/** Center of a page element in client coordinates + its box. */
export async function pageBox(page: Page, n: number) {
  const el = page.locator(`.pane.active .page[data-page-number="${n}"]`).first();
  await el.scrollIntoViewIfNeeded();
  const b = (await el.boundingBox())!;
  return b;
}
