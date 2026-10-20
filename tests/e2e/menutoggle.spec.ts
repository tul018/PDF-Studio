import { expect, test } from "@playwright/test";
import { openPdf, pageBox } from "./helpers";

/** Every button that opens a menu or panel closes it when clicked again. */
test("click again closes: Menu, tool menus, Shape…, modes, side panels, Home", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");

  const top = page.locator(".menubar .menu-top");
  await top.click();
  await expect(page.locator(".menubar .menu.open")).toHaveCount(1);
  await top.click();
  await expect(page.locator(".menubar .menu.open")).toHaveCount(0);

  for (const t of ["highlight", "text", "shape", "arrow"]) {
    const caret = page.locator(`[data-tool-menu="${t}"]`);
    await caret.click();
    await expect(page.locator(".tool-pop")).toHaveCount(1);
    await caret.click();
    await expect(page.locator(".tool-pop"), t).toHaveCount(0);
  }

  // Shape… in the properties bar, with a shape selected.
  const b = await pageBox(page, 1);
  await page.keyboard.press("c");
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 220, b.y + 400, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.mouse.click(b.x + 160, b.y + 350);
  const shapeBtn = page.locator(".props-bar .opt-shapemenu");
  await shapeBtn.click();
  await expect(page.locator(".tool-pop")).toHaveCount(1);
  await shapeBtn.click();
  await expect(page.locator(".tool-pop")).toHaveCount(0);

  // A mode opens its tools; clicking it again closes the tools panel.
  const edit = page.locator('[data-mode="edit"]');
  await edit.click();
  await expect(page.locator(".toolpanel")).toBeVisible();
  await edit.click();
  await expect(page.locator(".toolpanel")).toBeHidden();
  await edit.click();
  await expect(page.locator(".toolpanel")).toBeVisible();

  // Right rail: the open panel's icon closes it.
  const comments = page.locator('.rail [data-tab="comments"]');
  await comments.click();
  await expect(page.locator("#sidebar")).toBeVisible();
  await comments.click();
  await expect(page.locator("#sidebar")).toBeHidden();

  // Home over the document, and back.
  const home = page.locator(".home-btn");
  await home.click();
  await expect(page.locator(".home")).toBeVisible();
  await home.click();
  await expect(page.locator(".home")).toBeHidden();
});
