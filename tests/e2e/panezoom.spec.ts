import { expect, test } from "@playwright/test";
import { fixture, openPdf } from "./helpers";

test("split view: type a zoom percentage per pane, also while comparing another PDF", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.keyboard.press("Control+\\");
  const [a, b] = [page.locator(".pane").nth(0), page.locator(".pane").nth(1)];
  await a.locator(".pane-zoom").fill("135");
  await a.locator(".pane-zoom").press("Enter");
  await expect(a.locator(".pane-zoom")).toHaveValue("135%");
  await b.locator(".pane-zoom").fill("60%");
  await b.locator(".pane-zoom").press("Enter");
  await expect(b.locator(".pane-zoom")).toHaveValue("60%");
  await expect(a.locator(".pane-zoom")).toHaveValue("135%"); // each pane its own

  // Another PDF in pane B: its header zooms that PDF.
  const chooser = page.waitForEvent("filechooser");
  await b.locator('[data-pane-act="other"]').click();
  await (await chooser).setFiles(fixture("form.pdf"));
  await expect(b.locator(".compare-viewer")).toBeVisible();
  await b.locator(".pane-zoom").fill("80");
  await b.locator(".pane-zoom").press("Enter");
  await expect(b.locator(".pane-zoom")).toHaveValue("80%");
  const w = await b.locator(".compare-viewer .page").first().evaluate((el) => el.getBoundingClientRect().width);
  await b.locator(".pane-zoom").fill("160");
  await b.locator(".pane-zoom").press("Enter");
  await expect.poll(() => b.locator(".compare-viewer .page").first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(w * 1.8);
});
