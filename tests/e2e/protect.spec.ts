import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openPdf, cmd } from "./helpers";

test("save a password-protected copy (AES-256)", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "basic.pdf");
  await cmd(page, '[data-action="protect"]');
  const pw = page.locator(".modal input[type=password]");
  await pw.nth(0).fill("shop2026");
  await pw.nth(1).fill("shop2025");
  await page.getByRole("button", { name: "Save protected copy" }).click();
  await expect(page.locator(".modal .error-text")).toHaveText("The two passwords are different.");
  await pw.nth(1).fill("shop2026");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save protected copy" }).click();
  const bytes = new Uint8Array(readFileSync((await (await dl).path())!));
  await expect(getDocument({ data: bytes.slice() }).promise).rejects.toMatchObject({ name: "PasswordException" });
  const task = getDocument({ data: bytes.slice(), password: "shop2026" });
  expect((await task.promise).numPages).toBe(12);
  await task.destroy();
});
