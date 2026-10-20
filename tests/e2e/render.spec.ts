import { expect, test } from "@playwright/test";
import { openPdf, stats } from "./helpers";

test("rendering engine: switch between graphics card and processor", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  await page.locator('.tool-bar [data-action="pageNumbers"]').click();
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await page.locator('.menubar [data-action="settings"]').click();
  // Automatic is the default; switch to whichever engine it didn't pick here.
  const engine = page.locator(".modal select").nth(3);
  await expect(engine).toHaveValue("auto");
  const autoIsCpu = (await engine.locator('option[value="auto"]').textContent())!.includes("processor");
  const target = autoIsCpu ? "gpu" : "cpu";
  await engine.selectOption(target);
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator("#toast")).toContainText(target === "cpu" ? "processor (CPU)" : "graphics card (GPU)");
  await expect(page.locator('.pane.active .page[data-page-number="1"]:not(.loading) canvas.page-canvas')).toBeAttached();
  expect((await stats(page)).annotations).toBe(12); // unsaved edits kept through the reload
  expect(await page.evaluate(() => localStorage.getItem("pdfstudio:render"))).toBe(target);
});
