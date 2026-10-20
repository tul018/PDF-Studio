import { expect, test } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { cmd, openPdf, saveAndRead } from "./helpers";

test("page labels: roman front pages, then 1, 2, 3; saved in the PDF", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.fill("#page-input", "4");
  await page.press("#page-input", "Enter");
  await cmd(page, '[data-page-op="labels"]');
  // Suggested: i, ii, iii from page 1, then 1, 2, 3 from the current page (4).
  await expect(page.locator(".label-rule")).toHaveCount(2);
  await expect(page.locator(".label-preview")).toContainText("3→iii  4→1");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("#status-page")).toHaveText("Page 1 (4 of 12)");
  const bytes = await saveAndRead(page);
  const task = getDocument({ data: bytes.slice() });
  const labels = await (await task.promise).getPageLabels();
  await task.destroy();
  expect(labels?.slice(0, 5)).toEqual(["i", "ii", "iii", "1", "2"]);
});
