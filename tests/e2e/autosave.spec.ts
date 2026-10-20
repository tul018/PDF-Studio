import { expect, test } from "@playwright/test";
import { cmd, openPdf } from "./helpers";

test("quick save button; auto-save toggle is remembered and shows a check", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.locator('.pageops [data-page-op="rotR"]').click();
  const dl = page.waitForEvent("download");
  await page.locator('.main-bar .quick [data-action="save"]').click();
  expect((await dl).suggestedFilename()).toBe("basic.pdf");

  const item = page.locator('.menubar [data-action="autosave"]');
  await expect(item).toHaveAttribute("aria-checked", "false");
  await cmd(page, '[data-action="autosave"]');
  await expect(item).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#toast")).toContainText("only works in the PC app");
  await page.reload();
  await expect(page.locator('.menubar [data-action="autosave"]')).toHaveAttribute("aria-checked", "true");
});
