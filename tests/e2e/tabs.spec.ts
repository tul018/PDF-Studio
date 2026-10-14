import { expect, test } from "@playwright/test";
import { openPdf, stats } from "./helpers";

test("tabs: two files open, edits kept when switching, close a tab", async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await openPdf(page, "basic.pdf");
  await page.locator('.tool-bar [data-action="pageNumbers"]').click();
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await page.fill("#page-input", "7");
  await page.press("#page-input", "Enter");

  await openPdf(page, "languages.pdf"); // opens in a new tab
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab.active")).toContainText("languages.pdf");
  await expect(page.locator(".tab").first()).toContainText("● basic.pdf"); // unsaved edits kept
  expect((await stats(page)).annotations).toBe(0);

  await page.locator(".tab").first().click();
  await expect(page.locator("#page-total")).toHaveText("/ 12");
  await expect.poll(async () => (await stats(page)).annotations).toBe(12);
  await expect(page.locator("#status-page")).toHaveText("Page 7 of 12"); // same place

  // Close the other tab; then the edited one asks before discarding.
  await page.locator(".tab").nth(1).locator(".tab-close").click();
  await expect(page.locator("#tabbar")).toBeHidden(); // one file left: no tab bar
  await expect(page.locator("#page-total")).toHaveText("/ 12");
});
