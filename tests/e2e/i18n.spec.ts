import { expect, test } from "@playwright/test";
import { openPdf, cmd } from "./helpers";

test("menus in Thai and Chinese, documents untouched", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await cmd(page, '[data-action="settings"]');
  await page.locator(".modal select").first().selectOption("th");
  await page.locator(".modal").getByRole("button", { name: "Close" }).click();
  await expect(page.locator('.menubar [data-menu="File"]')).toHaveText("ไฟล์");
  await expect(page.locator("#status-page")).toHaveText("หน้า 1 จาก 12");
  await cmd(page, '[data-action="pageNumbers"]');
  await expect(page.locator(".modal h2")).toHaveText("เลขหน้า");
  await page.keyboard.press("Escape");
  await expect(page.locator(".pane.active .textLayer").first()).toContainText("Page 1"); // the PDF stays as it is
  await page.reload();
  await expect(page.locator('.menubar [data-menu="File"]')).toHaveText("ไฟล์"); // remembered
  await cmd(page, '[data-action="settings"]');
  await page.locator(".modal select").first().selectOption("zh");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator('.menubar [data-menu="File"]')).toHaveText("文件");
  await cmd(page, '[data-action="settings"]');
  await page.locator(".modal select").first().selectOption("en");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator('.menubar [data-menu="File"]')).toHaveText("File");
});
