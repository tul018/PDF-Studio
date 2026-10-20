import { expect, test } from "@playwright/test";
import { cmd, openPdf, pageBox, stats } from "./helpers";

test("zoom to area, snapshot to the clipboard, layers and attachments", async ({ page, context }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE:", m.text()));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openPdf(page, "basic.pdf");
  const zoom0 = (await stats(page)).zoom;
  await cmd(page, '[data-action="zoomArea"]');
  let b = await pageBox(page, 1);
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 160, b.y + 120, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await stats(page)).zoom).toBeGreaterThan(zoom0 * 2);

  await page.keyboard.press("Control+0"); // fit width again
  await cmd(page, '[data-action="snapshot"]');
  b = await pageBox(page, 1);
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 220, b.y + 120, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#toast")).toContainText("Picture copied");
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  expect(types).toContain("image/png");

  await cmd(page, '[data-action="layers"]');
  await expect(page.locator(".modal")).toContainText("This document has no layers.");
  await page.getByRole("button", { name: "Close" }).click();
  await cmd(page, '[data-action="attachments"]');
  await expect(page.locator(".modal")).toContainText("no attached files");
});
