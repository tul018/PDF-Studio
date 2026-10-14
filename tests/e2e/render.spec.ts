import { expect, test } from "@playwright/test";
import { openPdf, stats } from "./helpers";

test("rendering engine: switch between graphics card and processor", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.locator('[data-action="pageNumbers"]').click();
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await page.locator('[data-action="settings"]').click();
  await page.locator(".modal select").nth(3).selectOption("cpu");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator("#toast")).toContainText("processor (CPU)");
  await expect(page.locator('.pane.active .page[data-page-number="1"]:not(.loading) canvas.page-canvas')).toBeAttached();
  expect((await stats(page)).annotations).toBe(12); // unsaved edits kept through the reload
  expect(await page.evaluate(() => localStorage.getItem("pdfstudio:render"))).toBe("cpu");
});
