import { expect, test } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPdf, pageBox, saveAndRead, cmd } from "./helpers";

test("OCR makes a scan searchable", async ({ page }) => {
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE:", m.text().slice(0, 300)));
  page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
  test.setTimeout(180_000);
  await page.goto("/");
  // A "scan": a picture of a text page, made into an image-only PDF.
  await openPdf(page, "basic.pdf");
  const shot = join(tmpdir(), `pdfstudio-scan-${Date.now()}.png`);
  const b = await pageBox(page, 1);
  await page.screenshot({ path: shot, clip: { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 700) } });
  const chooser = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="fromPhotos"]');
  await (await chooser).setFiles(shot);
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(page.locator(".tab.active")).toContainText("Photos");
  await page.keyboard.press("Control+f");
  await page.fill(".pane.active .search-input", "quick brown");
  await expect(page.locator(".pane.active .search-count")).toHaveText("No results"); // only a picture
  await page.keyboard.press("Escape");

  await cmd(page, '[data-action="ocr"]');
  await page.getByLabel("Thai").uncheck();
  await page.locator(".modal").getByRole("button", { name: "Recognize", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("(searchable)", { timeout: 150_000 });
  await page.keyboard.press("Control+f");
  await page.fill(".pane.active .search-input", "quick brown");
  await expect(page.locator(".pane.active .search-count")).toHaveText("1 of 1");
  // Search must also work after the invisible text layer is saved and reopened.
  await page.keyboard.press("Escape");
  const bytes = await saveAndRead(page);
  const reopen = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="open"]');
  await (await reopen).setFiles({ name: "ocr-reopened.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await expect(page.locator(".tab.active")).toContainText("ocr-reopened");
  await page.keyboard.press("Control+f");
  await page.fill(".pane.active .search-input", "quick brown");
  await expect(page.locator(".pane.active .search-count")).toHaveText("1 of 1");
});
