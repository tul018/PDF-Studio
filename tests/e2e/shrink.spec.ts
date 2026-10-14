import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { openPdf, cmd } from "./helpers";

test("shrink a photo PDF", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await openPdf(page, "heavy-images.pdf"); // 261 MB, 16 distinct 3200 x 2400 photos
  await cmd(page, '[data-action="shrink"]');
  const dl = page.waitForEvent("download", { timeout: 220_000 });
  await page.getByRole("button", { name: "Shrink", exact: true }).click();
  const file = (await (await dl).path())!;
  const bytes = readFileSync(file);
  expect(bytes.length).toBeLessThan(40 * 1048576);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(400);
  await expect(page.locator("#toast")).toContainText("smaller");
});
