import { expect, test } from "@playwright/test";
import { openPdf } from "./helpers";

test("print dialog: preview, 4 pages per sheet, odd pages, booklet", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf"); // 12 pages
  // Capture what would be printed instead of opening the system dialog.
  await page.evaluate(() => {
    window.print = () => {
      const imgs = [...document.querySelectorAll<HTMLImageElement>("#print-root img")];
      (window as unknown as { __printed: unknown }).__printed = {
        count: imgs.length,
        classes: imgs.map((i) => i.className),
        css: [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("\n"),
      };
    };
  });
  await page.keyboard.press("Control+p");
  const dlg = page.locator(".print-dialog");
  await expect(dlg.locator(".print-frame canvas")).toBeVisible();
  await expect(dlg.locator(".print-count")).toHaveText("Sheet 1 of 12");
  await dlg.locator("select").nth(2).selectOption("4"); // Layout
  await expect(dlg.locator(".print-count")).toHaveText("Sheet 1 of 3");
  await dlg.locator("select").nth(1).selectOption("odd"); // 6 pages -> 2 sheets
  await expect(dlg.locator(".print-count")).toHaveText("Sheet 1 of 2");
  await dlg.getByRole("button", { name: "Next sheet" }).click();
  await expect(dlg.locator(".print-count")).toHaveText("Sheet 2 of 2");
  await dlg.getByRole("button", { name: "Print…" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: { count: number } }).__printed?.count)).toBe(2);
  const printed = await page.evaluate(() => (window as unknown as { __printed: { classes: string[]; css: string } }).__printed);
  expect(printed.classes).toEqual(["sheet-p", "sheet-p"]);
  expect(printed.css).toContain("@page sheet-p { size: 210mm 297mm"); // A4
  // Remembered; a booklet of all 12 pages is 6 sides.
  await page.keyboard.press("Control+p");
  await expect(dlg.locator("select").nth(2)).toHaveValue("4");
  await dlg.locator("select").nth(1).selectOption("all");
  await dlg.locator("select").nth(2).selectOption("booklet");
  await expect(dlg.locator(".print-count")).toHaveText("Sheet 1 of 6");
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
});
