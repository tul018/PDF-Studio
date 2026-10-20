import { expect, test } from "@playwright/test";
import { fixture, openPdf } from "./helpers";

const shown = (pane: import("@playwright/test").Locator) => pane.locator(".pane-zoom option[data-custom]");

test("split view: a zoom drop-down per pane, also while comparing another PDF", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.keyboard.press("Control+\\");
  const [a, b] = [page.locator(".pane").nth(0), page.locator(".pane").nth(1)];
  await a.locator(".pane-zoom").selectOption("1.5");
  await expect(shown(a)).toHaveText("150%");
  await b.locator(".pane-zoom").selectOption("0.5");
  await expect(shown(b)).toHaveText("50%");
  await expect(shown(a)).toHaveText("150%"); // each pane its own
  // Any percentage: Other %…
  await b.locator(".pane-zoom").selectOption("other");
  await page.locator(".modal-input").fill("135");
  await page.locator(".modal .btn.primary").click();
  await expect(shown(b)).toHaveText("135%");

  // Another PDF in pane B: its drop-down zooms that PDF.
  const chooser = page.waitForEvent("filechooser");
  await b.locator('[data-pane-act="other"]').click();
  await (await chooser).setFiles(fixture("form.pdf"));
  await expect(b.locator(".compare-viewer")).toBeVisible();
  await b.locator(".pane-zoom").selectOption("0.75");
  await expect(shown(b)).toHaveText("75%");
  const w = await b.locator(".compare-viewer .page").first().evaluate((el) => el.getBoundingClientRect().width);
  await b.locator(".pane-zoom").selectOption("2");
  await expect(shown(b)).toHaveText("200%");
  await expect.poll(() => b.locator(".compare-viewer .page").first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(w * 2.5);
});
