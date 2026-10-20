import { expect, test } from "@playwright/test";
import { fixture } from "./helpers";

test("make a PDF from photos", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.locator('.home [data-action="fromPhotos"]').click();
  await (await chooser).setFiles([fixture("seal.png"), fixture("seal.png")]);
  await page.getByLabel("Scan look: clean black & white (receipts, documents)").check();
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(page.locator("#page-total")).toHaveText("/ 2");
  await expect(page.locator("#status-file")).toContainText("Photos ");
});
