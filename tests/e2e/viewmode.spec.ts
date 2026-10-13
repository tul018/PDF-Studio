import { expect, test } from "@playwright/test";
import { openPdf } from "./helpers";

test("two pages side by side, one page at a time, night pages", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "basic.pdf");
  await page.locator("#view-mode").selectOption("spread");
  const p2 = page.locator('.pane.active .page[data-page-number="2"]');
  const p3 = page.locator('.pane.active .page[data-page-number="3"]');
  await expect(p3).toBeAttached();
  const [b2, b3] = [await p2.boundingBox(), await p3.boundingBox()];
  expect(Math.abs(b2!.y - b3!.y)).toBeLessThan(2); // same row
  expect(b3!.x).toBeGreaterThan(b2!.x + b2!.width - 1); // to the right
  await page.locator("#view-mode").selectOption("single");
  await expect(page.locator(".pane.active .viewer")).toHaveClass(/snap/);
  await page.locator('[data-action="nightPages"]').click();
  await expect(page.locator("body")).toHaveClass(/night-pages/);
  await page.reload();
  await expect(page.locator("#view-mode")).toHaveValue("single"); // remembered
});
