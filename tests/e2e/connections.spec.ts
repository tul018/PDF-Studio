import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { openPdf, cmd } from "./helpers";
import { WebSocket } from "ws";

test("Claude MCP pairs with PDF Studio and requires approval for edits",async({page})=>{
  const token=randomBytes(32).toString("hex");const client=new Client({name:"pdfstudio-test",version:"1"});
  const transport=new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),"connector/server.mjs")],env:{...process.env as Record<string,string>,PDF_STUDIO_PAIRING_TOKEN:token}});
  try{await client.connect(transport);await page.goto("/");await openPdf(page,"basic.pdf");
    await cmd(page, '[data-action="connector"]');await page.getByLabel("Pairing token").fill(token);await page.getByRole("button",{name:"Connect",exact:true}).click();await expect(page.locator("body")).toContainText("Claude connector connected.");
    const status=await client.callTool({name:"pdf_status",arguments:{}});expect(status.isError).not.toBe(true);expect(status.structuredContent).toMatchObject({pages:12,name:"basic.pdf"});
    const read=await client.callTool({name:"pdf_read_text",arguments:{page:1}});expect(JSON.stringify(read)).toContain("quick brown");
    const call=client.callTool({name:"pdf_add_comment",arguments:{page:1,text:"Review from Claude"}});await expect(page.getByRole("dialog")).toContainText("Claude requests an action");await page.getByRole("button",{name:"Allow once",exact:true}).click();expect((await call).isError).not.toBe(true);await expect(page.locator(".pane.active .annot")).toHaveCount(1);
    const rejected=await new Promise<number>(resolve=>{const ws=new WebSocket(`ws://127.0.0.1:32149/?token=${token}`,{origin:"https://untrusted.example"});ws.on("unexpected-response",(_req,res)=>{res.resume();ws.terminate();resolve(res.statusCode!);});ws.on("error",()=>{});});expect(rejected).toBe(401);
  }finally{await client.close();await transport.close();}
});

test("encrypted live session shares a PDF and concurrent annotation changes",async({browser})=>{
  let relay:ChildProcess|undefined;const context=await browser.newContext();const host=await context.newPage(),guest=await context.newPage();
  try{relay=spawn(process.execPath,[join(process.cwd(),"collaboration/server.mjs")],{windowsHide:true});await new Promise<void>((resolve,reject)=>{relay!.stdout!.once("data",()=>resolve());relay!.once("error",reject);});
    await host.goto("http://localhost:4173/");await openPdf(host,"basic.pdf");await cmd(host, '[data-action="live"]');await host.getByRole("button",{name:"Connect",exact:true}).click();
    await expect(host.getByRole("dialog")).toContainText("Session is live");const code=await host.getByLabel("Editor invitation").inputValue();await host.getByRole("button",{name:"Close",exact:true}).click();
    await guest.goto("http://localhost:4173/");await cmd(guest, '[data-action="live"]');await guest.getByLabel("Session",{exact:true}).selectOption("Join session");await guest.getByLabel("Invitation code (to join)").fill(code);await guest.getByRole("button",{name:"Connect",exact:true}).click();await expect(guest.locator("body.has-doc")).toBeVisible();await expect(guest.locator(".tab.active")).toContainText("Live");
    for(const page of [host,guest]){await page.locator('[data-tool="rect"]').click();const box=await page.locator('.pane.active .page[data-page-number="1"]').boundingBox();await page.mouse.move(box!.x+100,box!.y+250);await page.mouse.down();await page.mouse.move(box!.x+220,box!.y+300);await page.mouse.up();}
    await expect(host.locator(".pane.active .annot")).toHaveCount(2);await expect(guest.locator(".pane.active .annot")).toHaveCount(2);
    await host.keyboard.press("Control+z");await expect(host.locator(".pane.active .annot")).toHaveCount(1);await expect(guest.locator(".pane.active .annot")).toHaveCount(1);
    await host.keyboard.press("Control+y");await expect(host.locator(".pane.active .annot")).toHaveCount(2);await expect(guest.locator(".pane.active .annot")).toHaveCount(2);
  }finally{await context.close();relay?.kill();}
});
