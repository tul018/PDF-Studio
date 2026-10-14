import { expect, test } from "@playwright/test";
import { cmd, fixture, openPdf, stats } from "./helpers";

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
  await expect(page.locator(".tab")).toHaveCount(1); // one file left: its tab (with ×) stays
  await expect(page.locator("#page-total")).toHaveText("/ 12");
});

test("a single file has a close button; closing it goes back to the start screen", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "basic.pdf");
  await expect(page.locator(".tab")).toHaveCount(1);
  await page.locator(".tab .tab-close").click();
  await expect(page.locator("body.has-doc")).toHaveCount(0);
  await expect(page.locator(".tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open PDF…" })).toBeVisible();
  // ...and a fresh start: opening again works.
  await openPdf(page, "form.pdf");
  await expect(page.locator(".tab")).toHaveCount(1);
});

test("quick tab switching while a big file loads ends on the last tab clicked, nothing lost", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await openPdf(page, "basic.pdf");
  // Open the big file and, without waiting, another one.
  const ch = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="open"]');
  await (await ch).setFiles(fixture("heavy-images.pdf"));
  // Opened while the big one is still loading: it waits its turn instead of mixing up the tabs.
  const ch2 = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="open"]');
  await (await ch2).setFiles(fixture("languages.pdf"));
  await expect(page.locator(".tab")).toHaveCount(3, { timeout: 60_000 });
  await expect(page.locator(".tab.active")).toContainText("languages.pdf", { timeout: 60_000 });
  // Clicks straight on the tabs (the "Opening…" screen would otherwise catch them), faster than files load.
  await page.evaluate(async () => {
    for (const k of [1, 0, 1, 2, 1, 0, 2, 1, 0]) {
      document.querySelectorAll<HTMLElement>(".tab")[k].click();
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await expect(page.locator(".tab.active")).toHaveAttribute("data-tab-i", "0", { timeout: 60_000 });
  await expect(page.locator("#page-total")).toHaveText("/ 12", { timeout: 60_000 });
  // Every tab still opens.
  for (const [k, total] of [[1, "/ 400"], [2, null], [0, "/ 12"]] as const) {
    await page.locator(".tab").nth(k).click();
    await expect(page.locator(".tab.active")).toHaveAttribute("data-tab-i", String(k), { timeout: 60_000 });
    await expect(page.locator("body.has-doc")).toBeVisible({ timeout: 60_000 });
    if (total) await expect(page.locator("#page-total")).toHaveText(total, { timeout: 60_000 });
  }
  const names = await page.locator(".tab .tab-name").allTextContents();
  expect(names.map((n) => n.replace("● ", ""))).toEqual(["basic.pdf", "heavy-images.pdf", "languages.pdf"]);
  expect(errors).toEqual([]);
});
