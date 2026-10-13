import { expect, test } from "@playwright/test";
import { fixture } from "./helpers";

/** Folder search: pick a folder, search every PDF in it, open a result at its page. */
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("search a folder of PDFs (no document open), open a result at its page", async ({ page }) => {
  await page.getByRole("button", { name: "Search a folder of PDFs…" }).click();
  const panel = page.locator('[data-panel="folder"]');
  await expect(panel).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "Choose folder…" }).click();
  await (await chooser).setFiles(fixture("catalogs"));
  await expect(page.locator("#folder-name")).toContainText("3 PDFs"); // notes.txt ignored

  await page.fill("#folder-query", "needle");
  await expect(page.locator("#folder-status")).toHaveText(
    "2 matches in 1 of 3 files. 1 file has no text (scans: needs OCR).",
  );
  const hits = page.locator(".folder-hit");
  await expect(hits).toHaveCount(2);
  await expect(hits.nth(0)).toContainText("p. 3");
  await expect(hits.nth(1)).toContainText("p. 10");
  await expect(hits.nth(1).locator("mark")).toHaveText("needle");

  // Chinese, in the subfolder.
  await page.fill("#folder-query", "世界和平");
  await expect(page.locator(".folder-file-name")).toContainText("languages.pdf");

  // Open a result: the file opens at that page, the word highlighted.
  await page.fill("#folder-query", "needle");
  await hits.nth(1).click();
  await expect(page.locator("#status-page")).toHaveText("Page 10 of 12");
  await expect(page.locator(".pane.active .search-count")).toHaveText("2 of 2");
  await expect(page.locator('.page[data-page-number="10"] .search-hit.current')).toBeInViewport();
  // The folder results stay, for the next lookup.
  await expect(page.locator(".folder-hit")).toHaveCount(2);
});
