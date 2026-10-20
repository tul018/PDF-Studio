import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { cmd } from "./helpers";

/** A small order form: total = price * qty (2 decimals), sum = price + total. */
async function orderForm(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();
  for (const [n, y] of [["price", 250], ["qty", 200], ["total", 150], ["sum", 100]] as const) {
    form.createTextField(n).addToPage(page, { x: 50, y, width: 200, height: 24 });
  }
  const js = (s: string) => doc.context.obj({ S: "JavaScript", JS: PDFString.of(s) });
  form.getTextField("total").acroField.dict.set(
    PDFName.of("AA"),
    doc.context.obj({ C: js("/** BVCALC price * qty EVCALC **/ event.value = 0"), F: js('AFNumber_Format(2, 0, 0, 0, "", true);') }),
  );
  form.getTextField("sum").acroField.dict.set(PDFName.of("AA"), doc.context.obj({ C: js('AFSimple_Calculate("SUM", new Array ("price", "total"));') }));
  writeFileSync(path, await doc.save());
}

test("form calculations, export and import form data", async ({ page }, info) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  const file = info.outputPath("order.pdf");
  await orderForm(file);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const chooser = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="open"]');
  await (await chooser).setFiles(file);
  const fields = page.locator(".pane.active .form-layer input");
  await expect(fields).toHaveCount(4);
  await fields.nth(0).fill("100");
  await fields.nth(0).press("Tab");
  await fields.nth(1).fill("3");
  await fields.nth(1).press("Tab");
  await expect(fields.nth(2)).toHaveValue("300.00");
  await expect(fields.nth(3)).toHaveValue("400");

  const dl = page.waitForEvent("download");
  await cmd(page, '[data-action="exportForm"]');
  const csv = readFileSync((await (await dl).path())!, "utf8");
  expect(csv.replace(/^﻿/, "").split(/\r\n/).slice(0, 2)).toEqual(["price,qty,total,sum", "100,3,300.00,400"]);

  const json = info.outputPath("data.json");
  writeFileSync(json, JSON.stringify({ price: "20", qty: "5", unknown: "x" }));
  const picker = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="importForm"]');
  await (await picker).setFiles(json);
  await expect(page.locator("#toast")).toContainText("Filled 2 fields");
  await expect(fields.nth(2)).toHaveValue("100.00");
  await expect(fields.nth(3)).toHaveValue("120");
});
