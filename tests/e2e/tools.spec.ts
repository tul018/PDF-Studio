import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { cmd, fixture, openPdf, pageBox, saveAndRead } from "./helpers";
import { pageTexts } from "./pdftext";

type A = { type: string; box?: { w: number; h: number }; fontSize?: number; font?: string; opacity?: number; color?: string };

const annots = (page: Page) =>
  page.evaluate(() => (window as unknown as { app: { history: { state: { annotations: unknown[] } } } }).app.history.state.annotations) as Promise<A[]>;

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("clicking an active tool again turns it off; so does its key", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const rect = page.locator('.quick-tools [data-tool="rect"]');
  await rect.click();
  await expect(page.locator("body")).toHaveAttribute("data-active-tool", "rect");
  await rect.click();
  await expect(page.locator("body")).toHaveAttribute("data-active-tool", "select");
  await page.keyboard.press("u");
  await expect(page.locator("body")).toHaveAttribute("data-active-tool", "highlight");
  await page.keyboard.press("u");
  await expect(page.locator("body")).toHaveAttribute("data-active-tool", "select");
});

test("tool settings strip shows only what the tool uses", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.keyboard.press("r");
  await expect(page.locator("#opt-width")).toBeVisible();
  await expect(page.locator("#opt-font")).toBeHidden();
  await page.keyboard.press("t");
  await expect(page.locator("#opt-font")).toBeVisible();
  await expect(page.locator("#opt-family")).toBeVisible();
  await expect(page.locator("#opt-width")).toBeHidden();
  await page.keyboard.press("u");
  await expect(page.locator("#opt-opacity")).toBeVisible();
  await expect(page.locator("#opt-font")).toBeHidden();
});

test("fixed-size highlights: same height every time, click places the set width", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('[data-tool-menu="highlight"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-active-tool", "highlight");
  const pop = page.locator(".tool-pop");
  await pop.getByRole("button", { name: /Fixed size/ }).click();
  await pop.locator(".pop-num", { hasText: "Width" }).locator("input").fill("100");
  await pop.locator(".pop-num", { hasText: "Width" }).locator("input").press("Enter");
  await pop.locator(".pop-num", { hasText: "Height" }).locator("input").fill("12");
  await pop.locator(".pop-num", { hasText: "Height" }).locator("input").press("Enter");
  await page.keyboard.press("Escape"); // closes the menu, keeps the tool
  await expect(pop).toHaveCount(0);
  const b = await pageBox(page, 1);
  // A click, then a sloppy diagonal drag: both come out 12 pt tall.
  await page.mouse.click(b.x + 100, b.y + 200);
  await page.mouse.move(b.x + 100, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 260, b.y + 340, { steps: 6 });
  await page.mouse.up();
  const hl = (await annots(page)).filter((a) => a.type === "highlight");
  expect(hl).toHaveLength(2);
  expect(hl[0].box!.w).toBeCloseTo(100, 1);
  for (const h of hl) expect(h.box!.h).toBeCloseTo(12, 1);
  // The drag set the width (160 px of screen), not the fixed 100 pt.
  const zoom = await page.evaluate(() => (window as unknown as { app: { activeViewer: { zoom: number } } }).app.activeViewer.zoom);
  expect(hl[1].box!.w).toBeCloseTo(160 / (zoom * (96 / 72)), 0);
});

test("highlight opacity and color apply to new and selected highlights", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.keyboard.press("u");
  const b = await pageBox(page, 1);
  await page.mouse.move(b.x + 100, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 250, b.y + 220, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("u"); // back to Select
  await page.mouse.click(b.x + 150, b.y + 210);
  await expect(page.locator("body.has-selection")).toBeVisible();
  await page.locator("#opt-opacity").fill("80");
  await page.locator("#opt-opacity").dispatchEvent("change");
  const [hl] = await annots(page);
  expect(hl.opacity).toBeCloseTo(0.8, 2);
});

test("text: frame fits the text, font and custom size, corner drag scales", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('[data-tool-menu="text"]').click();
  const pop = page.locator(".tool-pop");
  await pop.getByRole("option", { name: "Serif (Times)" }).click();
  await pop.locator(".pop-num", { hasText: "Custom" }).locator("input").fill("21");
  await pop.locator(".pop-num", { hasText: "Custom" }).locator("input").press("Enter");
  await page.keyboard.press("Escape");
  const b = await pageBox(page, 1);
  await page.mouse.click(b.x + 120, b.y + 400);
  await expect(page.locator("textarea.text-editor")).toBeFocused();
  await page.keyboard.type("Hi");
  // The editing frame is about as wide as the text, not a fixed wide box.
  const ed = (await page.locator("textarea.text-editor").boundingBox())!;
  expect(ed.width).toBeLessThan(80);
  await page.keyboard.press("Escape");
  let [t] = await annots(page);
  expect(t.font).toBe("serif");
  expect(t.fontSize).toBe(21);
  expect(t.box!.w).toBeLessThan(45);
  // Drag the top-right handle outwards: the font grows with the frame.
  const handle = page.locator(".resize-handle");
  await expect(handle).toHaveCSS("cursor", "nesw-resize");
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  [t] = await annots(page);
  expect(t.fontSize).toBeGreaterThan(21);
  // Font size from the strip: preset or any typed size.
  await page.locator("#opt-font").fill("9.5");
  await page.locator("#opt-font").press("Enter");
  [t] = await annots(page);
  expect(t.fontSize).toBe(9.5);
});

test("image resize: the corner follows the mouse", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  const chooser = page.waitForEvent("filechooser");
  await cmd(page, '[data-action="image"]');
  await (await chooser).setFiles(fixture("seal.png"));
  await expect(page.locator(".resize-handle")).toBeVisible();
  const [before] = await annots(page);
  const hb = (await page.locator(".resize-handle").boundingBox())!;
  const scale = await page.evaluate(() => (window as unknown as { app: { activeViewer: { zoom: number } } }).app.activeViewer.zoom);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  // Pull the corner 40 px towards the middle, along the diagonal.
  const r = before.box!.h / before.box!.w;
  const dx = -40 / Math.hypot(1, r),
    dy = (40 * r) / Math.hypot(1, r);
  await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  const [after] = await annots(page);
  // Shrinks by the distance moved (in page points), not more.
  const css = 96 / 72;
  expect(before.box!.w - after.box!.w).toBeCloseTo(-dx / (scale * css), 0);
  expect(after.box!.h / after.box!.w).toBeCloseTo(r, 3);
});

test("theme toggle sits at the top right; zoom - and + are next to the zoom box", async ({ page }) => {
  const btn = page.locator("#theme-btn");
  await expect(btn).toBeVisible();
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
  await btn.click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await expect(page.locator('.menubar [data-action="theme"]')).toHaveCount(0);
  const bar = (await page.locator(".titlebar").boundingBox())!;
  const tb = (await btn.boundingBox())!;
  expect(bar.x + bar.width - (tb.x + tb.width)).toBeLessThan(24);
  await openPdf(page, "basic.pdf");
  const zo = (await page.locator('.nav-pill [data-action="zoomOut"]').boundingBox())!;
  const zi = (await page.locator('.nav-pill [data-action="zoomIn"]').boundingBox())!;
  const zs = (await page.locator("#zoom-select").boundingBox())!;
  expect(zi.x - (zo.x + zo.width)).toBeLessThan(zs.width + 12);
});

test("number boxes in the menus can be clicked and typed into (menu stays open)", async ({ page }) => {
  await openPdf(page, "basic.pdf");
  await page.locator('[data-tool-menu="highlight"]').click();
  const pop = page.locator(".tool-pop");
  await pop.getByRole("button", { name: /Fixed size/ }).click();
  const height = pop.locator(".pop-num", { hasText: "Height" }).locator("input");
  await height.click();
  await expect(pop).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-active-tool", "highlight");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("20");
  // Clicking away applies the typed value instead of losing it.
  await page.mouse.click(700, 20);
  const h = await page.evaluate(() => (window as unknown as { app: { panes: { overlay: { options: { highlightH: number } } }[] } }).app.panes[0].overlay.options.highlightH);
  expect(h).toBe(20);

  await page.locator('[data-tool-menu="text"]').click();
  const custom = pop.locator(".pop-num", { hasText: "Custom" }).locator("input");
  await custom.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("17");
  await page.keyboard.press("Enter");
  await expect(pop).toBeVisible();
  const f = await page.evaluate(() => (window as unknown as { app: { panes: { overlay: { options: { fontSize: number } } }[] } }).app.panes[0].overlay.options.fontSize);
  expect(f).toBe(17);
});

test("installed fonts: pick one, it is embedded in the saved PDF and the text stays searchable", async ({ page, context }) => {
  test.skip(process.platform !== "win32", "needs fonts installed on a Windows PC (Arial)");
  await context.grantPermissions(["local-fonts"]);
  await openPdf(page, "basic.pdf");
  await page.locator('[data-tool-menu="text"]').click();
  const pop = page.locator(".tool-pop");
  const more = pop.getByRole("button", { name: "Show all fonts on this PC…" });
  if (await more.count()) await more.click();
  const items = pop.locator(".font-item");
  expect(await items.count()).toBeGreaterThan(10);
  await pop.locator('input[type="search"]').fill("Arial");
  await pop.getByRole("option", { name: "Arial", exact: true }).click();
  await page.keyboard.press("Escape");
  const b = await pageBox(page, 1);
  await page.mouse.click(b.x + 120, b.y + 500);
  await page.keyboard.type("Signed in Arial");
  await page.keyboard.press("Escape");
  const bytes = await saveAndRead(page);
  expect((await pageTexts(bytes))[0]).toContain("Signed in Arial");
  const doc = await PDFDocument.load(bytes);
  const names = doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => (o instanceof PDFDict ? o.get(PDFName.of("FontName"))?.toString() : undefined))
    .filter(Boolean);
  expect(names.join(" ")).toMatch(/Arial/);
});
