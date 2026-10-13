import { expect, test } from "@playwright/test";
import { openPdf } from "./helpers";

test("menus in Thai and Chinese, documents untouched", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.locator('[data-action="settings"]').click();
  await page.locator(".modal select").first().selectOption("th");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator('.main-bar [data-action="open"] .lbl')).toHaveText("เปิด");
  await expect(page.locator("#status-page")).toHaveText("หน้า 1 จาก 12");
  await page.locator('[data-action="pageNumbers"]').click();
  await expect(page.locator(".modal h2")).toHaveText("เลขหน้า");
  await page.keyboard.press("Escape");
  await expect(page.locator(".pane.active .textLayer").first()).toContainText("Page 1"); // the PDF stays as it is
  await page.reload();
  await expect(page.locator('.main-bar [data-action="open"] .lbl')).toHaveText("เปิด"); // remembered
  await page.locator('[data-action="settings"]').click();
  await page.locator(".modal select").first().selectOption("zh");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator('.main-bar [data-action="open"] .lbl')).toHaveText("打开");
  await page.locator('[data-action="settings"]').click();
  await page.locator(".modal select").first().selectOption("en");
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator('.main-bar [data-action="open"] .lbl')).toHaveText("Open");
});
