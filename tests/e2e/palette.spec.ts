import { expect, test } from "@playwright/test";
import { openPdf } from "./helpers";

test("command palette: type, pick with arrows, run", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.keyboard.press("Control+k");
  const input = page.locator(".palette-input");
  await expect(input).toBeFocused();
  await input.fill("rotate right");
  await expect(page.locator(".palette-item").first()).toContainText("Rotate right");
  await expect(page.locator(".palette-item .palette-path").first()).toContainText("Edit › Pages");
  await input.press("Enter");
  await expect(page.locator(".palette-backdrop")).toHaveCount(0);
  await expect(page.locator("#status-file")).toContainText("●"); // the page was rotated: unsaved change
  // Esc closes; nothing matches nonsense.
  await page.keyboard.press("Control+k");
  await input.fill("zzzqqq");
  await expect(page.locator(".palette-none")).toBeVisible();
  await input.press("Escape");
  await expect(page.locator(".palette-backdrop")).toHaveCount(0);
});
