import { test, expect } from "@playwright/test";
import { fixture, openPdf, cmd } from "./helpers";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { unzipSync, strFromU8 } from "fflate";
import { readFileSync, writeFileSync } from "node:fs";
async function saveAndRead(page:import("@playwright/test").Page){const download=page.waitForEvent("download",{timeout:15000});await cmd(page, '[data-action="save"]');return new Uint8Array(readFileSync((await(await download).path())!));}
async function tool(page:import("@playwright/test").Page,name:string){await cmd(page, '[data-action="professional"]');await page.locator(`[data-pro="${name}"]`).click();}
async function text(bytes:Uint8Array){const task=getDocument({data:bytes.slice(),standardFontDataUrl:"node_modules/pdfjs-dist/standard_fonts/"});try{const doc=await task.promise;return(await(await doc.getPage(1)).getTextContent()).items.flatMap(i=>"str"in i?[i.str]:[]).join(" ");}finally{await task.destroy();}}
test.beforeEach(async({page})=>{await page.goto("/");await openPdf(page,"basic.pdf");});
test("professional tools create fields and searchable Bates numbering",async({page})=>{
  await tool(page,"forms");await page.getByLabel("Field name").fill("Account name");await page.getByRole("button",{name:"Apply",exact:true}).click();await expect(page.locator(".tab.active")).toContainText("(form)");
  let bytes=await saveAndRead(page);expect((await PDFDocument.load(bytes)).getForm().getFields().map(f=>f.getName())).toContain("Account name");
  await tool(page,"headers");await page.getByRole("button",{name:"Apply",exact:true}).click();await expect(page.locator(".tab.active")).toContainText("numbered");bytes=await saveAndRead(page);expect(await text(bytes)).toContain("DOC-000001");
});
test("redact by search removes every matched page's original text",async({page})=>{await tool(page,"redactSearch");await page.getByLabel("Exact text",{exact:true}).fill("quick brown");await page.getByRole("button",{name:"Apply",exact:true}).click();await page.getByRole("button",{name:"Mark matches",exact:true}).click();const bytes=await saveAndRead(page);expect(await text(bytes)).not.toContain("quick brown");expect((await PDFDocument.load(bytes)).getPageCount()).toBe(12);});
test("QR stamp is found offline",async({page})=>{await tool(page,"qrStamp");await page.getByLabel("Text or URL").fill("https://example.com/order/123");await page.getByRole("button",{name:"Apply",exact:true}).click();await expect(page.locator(".tab.active")).toContainText("(QR)");await tool(page,"qr");await expect(page.getByRole("dialog")).toContainText("https://example.com/order/123");});
test("Word and Excel exports contain actual extracted text",async({page})=>{for(const kind of ["word","excel"]){await tool(page,kind);const download=page.waitForEvent("download");await page.getByRole("button",{name:"Export",exact:true}).click();const result=await download;const zip=unzipSync(readFileSync((await result.path())!));const xml=strFromU8(zip[kind==="word"?"word/document.xml":"xl/worksheets/sheet1.xml"]);expect(xml).toContain("quick brown");}});
test("native annotations and incremental save survive export",async({page})=>{
  await cmd(page, '[data-action="engineSettings"]');await page.getByLabel("Save annotations").selectOption("Native editable annotations");await page.getByLabel("Incremental save",{exact:true}).selectOption("On");await page.getByRole("button",{name:"Apply",exact:true}).click();
  await page.locator('[data-tool="rect"]').click();const box=await page.locator('.pane.active .page[data-page-number="1"]').boundingBox();await page.mouse.move(box!.x+100,box!.y+200);await page.mouse.down();await page.mouse.move(box!.x+250,box!.y+250);await page.mouse.up();
  const bytes=await saveAndRead(page);const original=readFileSync(fixture("basic.pdf"));expect(Buffer.from(bytes.subarray(0,original.length))).toEqual(original);const doc=await PDFDocument.load(bytes);expect(doc.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray).size()).toBeGreaterThan(0);
});
test("archive copy carries PDF/A identification and an output profile",async({page},info)=>{await tool(page,"archive");await page.getByRole("button",{name:"Create archive copy",exact:true}).click();await expect(page.locator(".tab.active")).toContainText("archive");const bytes=await saveAndRead(page);const doc=await PDFDocument.load(bytes);expect(doc.catalog.has(PDFName.of("OutputIntents"))).toBe(true);expect(doc.catalog.has(PDFName.of("Metadata"))).toBe(true);expect(await text(bytes)).toBe("");writeFileSync(info.outputPath("archive.pdf"),bytes);});
