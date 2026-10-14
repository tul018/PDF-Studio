import type { App } from "../app";
import { BytesSource } from "../core/source";
import { buildPdf } from "../save/saver";
import { modal, title, buttons, toast, confirmDialog, progressOverlay } from "../ui/dialogs";
import { formDialog } from "./forms";
import { addFields, addHeaders, setBookmarks, comments, editComment, changedPixels, distance, area } from "./pdfTools";
import { renderPage, sanitizedCopy, withPdf } from "./render";
import { Search, extractPageText } from "../viewer/search";
import { uid, type Annotation } from "../edit/model";
import { shrinkPdf } from "../save/shrink";
import { saveEncrypted } from "../save/encrypt";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export class Workbench {
  constructor(readonly app: App) {}
  async bytes() { return buildPdf(this.app.history.state, this.app.store, this.app.images); }
  async open(bytes: Uint8Array, suffix: string) { await this.app.openSources([new BytesSource((this.app.mainDoc?.source.name.replace(/\.pdf$/i, "") || "Document") + ` (${suffix}).pdf`, bytes)]); }
  async run(action: string) {
    try {
      if (!this.app.mainDoc && action !== "batch") throw new Error("Open a PDF first.");
      switch (action) {
        case "compare": return await this.compare();
        case "redactSearch": return await this.redactSearch();
        case "sanitize": {
          if (!await confirmDialog("Remove hidden information", "Create an image-only copy of the visible pages. This removes metadata, attachments, comments, hidden layers, old revisions, forms and searchable text. The original stays open.", "Create clean copy")) return;
          const busy = progressOverlay("Removing hidden information");
          try { await this.open(await sanitizedCopy(await this.bytes(), f => busy.update("Cleaning pages", f)), "clean"); } finally { busy.close(); }
          return;
        }
        case "comments": return await this.commentPanel();
        case "forms": return await this.fields();
        case "headers": return await this.headers();
        case "bookmarks": return await this.bookmarks();
        case "measure": return await this.measure();
        case "word": case "excel": {
          if (!await confirmDialog("Export extracted text", "Exports text in reading order. Word keeps page breaks; Excel puts each text line in a row. Complex layouts and table structure are not reconstructed. Run OCR first for scanned pages.", "Export")) return;
          const { exportWord, exportExcel } = await import("./export"); const bytes = await this.bytes();
          return await this.download(action === "word" ? await exportWord(bytes) : await exportExcel(bytes), action === "word" ? "docx" : "xlsx");
        }
        case "batch": return await this.batch();
        case "qr": return await this.qr();
        case "qrStamp": return await this.qrStamp();
        case "certificate": return await this.certificate();
        case "editText": return await this.editText();
        case "archive": return await this.archive();
      }
    } catch (e) { toast((e as Error).message, "error", 10000); }
  }
  menu() {
    modal((box, close) => {
      title(box, "Professional tools", "Create revised copies, inspect changes, and prepare documents for sharing.");
      const grid = document.createElement("div"); grid.className = "pro-grid"; box.append(grid);
      for (const [action, label] of Object.entries({ compare: "Compare PDFs", redactSearch: "Redact by search", sanitize: "Remove hidden information", comments: "Comments", forms: "Create form fields", headers: "Headers / footers / Bates", bookmarks: "Edit bookmarks", measure: "Measure distance / area", word: "Export Word", excel: "Export Excel", batch: "Batch actions", qr: "Find QR codes", qrStamp: "Add QR code", certificate: "Certificate signature", editText: "Edit existing text", archive: "PDF/A archive copy" })) {
        const b = document.createElement("button"); b.className = "btn"; b.textContent = label; b.dataset.pro = action;
        b.onclick = () => { close(); void this.run(action); }; grid.append(b);
      }
      buttons(box, [{label: "Close", onClick: close}]);
    });
  }
  async download(bytes: Uint8Array, extension: string) {
    const name = (this.app.mainDoc?.source.name.replace(/\.pdf$/i, "") || "Document") + "." + extension;
    async function* files() { yield { name, bytes, mime: "application/octet-stream" }; }
    await this.app.platform.saveMany(files());
  }
  async fields() {
    const o = await formDialog("Create form field", "Coordinates are PDF points (72 points = 1 inch), measured from the bottom-left of the page.", [
      {key:"name",label:"Field name",value:"New field"}, {key:"type",label:"Field type",options:["text","checkbox"]},
      ...Object.entries({page:this.app.activeViewer.currentIndex+1,x:72,y:600,width:180,height:24}).map(([key,value]) => ({key,label:key,value:String(value),type:"number"})),
    ]);
    if (o) await this.open(await addFields(await this.bytes(), [{name:o.name,type:o.type as "text"|"checkbox",page:+o.page,x:+o.x,y:+o.y,width:+o.width,height:+o.height}]), "form");
  }
  async headers() {
    const o = await formDialog("Headers, footers and Bates numbering", "Use {page}, {pages}, and {bates}. Text uses the PDF standard Latin font.", [
      {key:"header",label:"Header"}, {key:"footer",label:"Footer",value:"Page {page} of {pages} | {bates}"}, {key:"prefix",label:"Bates prefix",value:"DOC-"}, {key:"start",label:"Start number",value:"1",type:"number"}, {key:"digits",label:"Digits",value:"6",type:"number"},
    ]);
    if (o) await this.open(await addHeaders(await this.bytes(), {header:o.header,footer:o.footer,prefix:o.prefix,start:+o.start,digits:+o.digits}), "numbered");
  }
  async bookmarks() {
    const outline = await this.app.mainDoc!.pdf.getOutline();
    const lines: string[] = [];
    const visit = async (nodes: NonNullable<typeof outline>) => {
      for (const b of nodes) { const dest = typeof b.dest === "string" ? await this.app.mainDoc!.pdf.getDestination(b.dest) : b.dest;
        if (dest) { const index = typeof dest[0] === "number" ? dest[0] : await this.app.mainDoc!.pdf.getPageIndex(dest[0]); lines.push(`${index+1} | ${b.title}`); }
        await visit(b.items);
      }
    };
    await visit(outline || []);
    const o = await formDialog("Edit bookmarks", "One bookmark per line: page | title. Reorder lines to reorder bookmarks. Saving replaces the outline with this flat list.", [{key:"list",label:"Bookmarks",value:lines.join("\n"),multiline:true}]);
    if (o) await this.open(await setBookmarks(await this.bytes(), o.list.split("\n").filter(l=>l.trim()).map(l=> { const i=l.indexOf("|"); return {page:Number(l.slice(0,i).trim()),title:l.slice(i+1).trim()}; })), "bookmarks");
  }
  async redactSearch() {
    const o = await formDialog("Redact by search", "Matches are marked for review. Saving removes the original content on affected pages.", [{key:"kind",label:"Find",options:["Exact text","Phone numbers","13-digit IDs"]},{key:"query",label:"Exact text"}]);
    if (!o) return;
    const terms = new Set<string>(); const state = this.app.history.state;
    if (o.kind === "Exact text") { if (!o.query.trim()) throw new Error("Enter text to redact."); terms.add(o.query); }
    else for (const ref of state.pages) { const page = await this.app.store.getPage(ref); if (!page) continue;
      const text = (await extractPageText(page)).text;
      const regex = o.kind === "Phone numbers" ? /(?<!\d)(?:\+?\d[\d ()-]{7,18}\d)(?!\d)/g : /(?<!\d)\d(?:[ -]?\d){12}(?!\d)/g;
      for (const match of text.matchAll(regex)) terms.add(match[0]);
    }
    const search = new Search(this.app.store); const annotations: Annotation[] = []; const seen = new Set<string>();
    for (const term of terms) { await search.run(term, state.pages, 0);
      for (const hit of search.hits) for (const [x,y,w,h] of hit.rects) {
        const key = `${hit.pageId}:${x}:${y}:${w}:${h}`; if (seen.has(key)) continue; seen.add(key);
        annotations.push({id:uid("redact"),pageId:hit.pageId,type:"redact",box:{x:x-1,y:y-1,w:w+2,h:h+2,rot:0},color:"#000000",opacity:1,strokeWidth:0});
      }
    }
    if (!annotations.length) { toast("No matches found.","info"); return; }
    if (await confirmDialog("Review redactions", `Mark ${annotations.length} text regions? Review the black boxes before saving.`, "Mark matches")) this.app.history.push({...state,annotations:[...state.annotations,...annotations]});
  }
  async commentPanel() {
    const bytes = await this.bytes(); const list = await comments(bytes);
    modal((box, close) => {
      title(box, "Comments", `${list.length} comments and replies`);
      const rows = document.createElement("div"); rows.className="pro-scroll"; box.append(rows);
      for (const c of list) {
        const row = document.createElement("section"); row.className="pro-comment";
        const text = document.createElement("p"); text.textContent=`Page ${c.page}${c.replyTo ? " · Reply" : ""}${c.resolved ? " · Resolved" : ""} — ${c.author || "Comment"}\n${c.text}`; row.append(text);
        buttons(row,[{label:"Go to page",onClick:()=>{this.app.activeViewer.scrollToPage(c.page-1);close();}},
          {label:c.resolved?"Reopen":"Resolve",onClick:()=>{close();void editComment(bytes,c.id,{resolved:!c.resolved}).then(b=>this.open(b,"comments")).catch(e=>toast(e.message,"error"));}},
          {label:"Reply",onClick:()=>{close();void formDialog("Reply","",[{key:"text",label:"Reply",multiline:true}]).then(async o=>{if(o) await this.open(await editComment(bytes,c.id,{reply:o.text}),"comments");}).catch(e=>toast(e.message,"error"));}}]); rows.append(row);
      }
      buttons(box,[{label:"Export comments",onClick:()=>{void this.download(new TextEncoder().encode(JSON.stringify(list,null,2)),"json");}},{label:"Close",onClick:close}]);
    });
  }
  async compare() {
    const picked = await this.app.platform.pickFiles(); if (!picked.length) return;
    const left = await this.bytes(), right = await picked[0].readAll();
    await withPdf(left, a => withPdf(right, b => new Promise<void>(resolve => {
      let index = 0, generation = 0;
      modal((box, close) => {
        box.classList.add("pro-wide"); title(box,"Compare PDFs",`${this.app.mainDoc?.source.name} ↔ ${picked[0].name}`);
        const status=document.createElement("p"), grid=document.createElement("div"); grid.className="compare-grid"; box.append(status,grid);
        let rendering = false, closed = false;
        const draw = async () => {
          if (rendering || closed) return; rendering = true; const token=++generation;
          try {
            const canvases: HTMLCanvasElement[]=[];
            for (const pdf of [a,b]) { if(index<pdf.numPages) canvases.push((await renderPage(pdf,index,96)).canvas); else {const c=document.createElement("canvas");c.width=612;c.height=792;canvases.push(c);} }
            if (closed || token!==generation) return;
            const w=Math.max(...canvases.map(c=>c.width)),h=Math.max(...canvases.map(c=>c.height));
            const normalized=canvases.map(c=>{const out=document.createElement("canvas");out.width=w;out.height=h;const ctx=out.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,w,h);ctx.drawImage(c,0,0);c.width=c.height=0;return out;});
            const diff=changedPixels(normalized[0].getContext("2d")!.getImageData(0,0,w,h).data,normalized[1].getContext("2d")!.getImageData(0,0,w,h).data);
            const overlay=document.createElement("canvas");overlay.width=w;overlay.height=h;overlay.getContext("2d")!.putImageData(new ImageData(diff.overlay as Uint8ClampedArray<ArrayBuffer>,w,h),0,0);
            normalized[1].getContext("2d")!.drawImage(overlay,0,0); grid.replaceChildren(...normalized);
            status.textContent=`Page ${index+1} of ${Math.max(a.numPages,b.numPages)} · ${diff.count} changed pixels (pink on right)${index>=Math.min(a.numPages,b.numPages)?" · Page only exists in one file":""}`;
          } catch(e) { status.textContent=(e as Error).message; } finally {rendering=false;if(closed)resolve();}
        };
        buttons(box,[{label:"Previous",onClick:()=>{if(!rendering){index=Math.max(0,index-1);void draw();}}},{label:"Next",onClick:()=>{if(!rendering){index=Math.min(Math.max(a.numPages,b.numPages)-1,index+1);void draw();}}},{label:"Close",onClick:()=>{closed=true;generation++;close();if(!rendering)resolve();}}]); void draw();
      });
    })));
  }
  async measure() {
    const o=await formDialog("Measure drawing","Click two or more points on the page. Scale is real-world units per PDF point; for a 1:100 drawing in millimetres use 35.2778.",[{key:"scale",label:"Units per PDF point",value:"1"},{key:"unit",label:"Unit",value:"pt"},{key:"mode",label:"Measurement",options:["Distance","Area"]}]); if(!o)return;
    const scale=Number(o.scale); if(!(scale>0)||!Number.isFinite(scale))throw new Error("Enter a positive scale.");
    await withPdf(await this.bytes(),async pdf=>{
      const {canvas,viewport}=await renderPage(pdf,this.app.activeViewer.currentIndex,110);
      modal((box,close)=>{box.classList.add("pro-wide");title(box,"Measure — click points");const status=document.createElement("p");const points:number[][]=[]; const original=document.createElement("canvas");original.width=canvas.width;original.height=canvas.height;original.getContext("2d")!.drawImage(canvas,0,0);canvas.className="measure-canvas";box.append(status,canvas);
        const draw=()=>{const ctx=canvas.getContext("2d")!;ctx.drawImage(original,0,0);ctx.beginPath();points.forEach((p,i)=>{const [x,y]=viewport.convertToViewportPoint(p[0],p[1]);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});if(o.mode==="Area"&&points.length>2)ctx.closePath();ctx.strokeStyle="#e11d48";ctx.lineWidth=3;ctx.stroke();status.textContent=`${(o.mode==="Area"?area(points,scale):distance(points,scale)).toFixed(3)} ${o.unit}${o.mode==="Area"?"²":""} · ${points.length} points`;};
        canvas.onclick=e=>{const r=canvas.getBoundingClientRect();points.push(viewport.convertToPdfPoint((e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height));draw();};
        buttons(box,[{label:"Undo point",onClick:()=>{points.pop();draw();}},{label:"Close",onClick:()=>{canvas.width=canvas.height=original.width=original.height=0;close();}}]);draw();
      });
    });
  }
  async batch() {
    const o=await formDialog("Batch actions","Choose files, then an output folder. Originals are never overwritten.",[{key:"action",label:"Action",options:["Compress","Stamp","Password"]},{key:"stamp",label:"Stamp text",value:"PAID"},{key:"password",label:"Password (for Password action)",type:"password"}]);if(!o)return;
    if(o.action==="Password"&&!o.password)throw new Error("Enter a password.");const sources=await this.app.platform.pickFiles(true);if(!sources.length)return;
    const busy=progressOverlay("Batch processing");const errors:string[]=[];
    async function* files(){for(const [i,source] of sources.entries()){busy.update(source.name,i/sources.length);try{let bytes=await source.readAll();
      if(o!.action==="Compress")bytes=(await shrinkPdf(bytes,"balanced")).bytes;
      else {const doc=await PDFDocument.load(bytes,{updateMetadata:false});if(o!.action==="Stamp"){const font=await doc.embedFont(StandardFonts.Helvetica);for(const p of doc.getPages())p.drawText(o!.stamp,{x:36,y:p.getHeight()-60,size:24,font,color:rgb(.8,.1,.1)});bytes=await doc.save();}
      else bytes=await saveEncrypted(doc,{userPassword:o!.password,ownerPassword:crypto.randomUUID(),allowPrint:true,allowCopy:false,allowEdit:false});}
      yield {name:source.name.replace(/\.pdf$/i," (batch).pdf"),bytes,mime:"application/pdf"};
    }catch(e){errors.push(`${source.name}: ${(e as Error).message}`);}}}
    try{const result=await this.app.platform.saveMany(files());if(result)toast(`${result.count} files saved${errors.length?`; ${errors.length} failed`:""}`,errors.length?"error":"ok",8000);if(errors.length)await formDialog("Batch errors","These files were not changed.",[{key:"errors",label:"Failures",value:errors.join("\n"),multiline:true}],"Close");}finally{busy.close();}
  }
  async qr() {
    const {default:jsQR}=await import("jsqr"); const results:Array<{page:number;text:string}>=[];
    await withPdf(await this.bytes(),async pdf=>{for(let i=0;i<pdf.numPages;i++){const {canvas}=await renderPage(pdf,i,160);const ctx=canvas.getContext("2d",{willReadFrequently:true})!;for(let n=0;n<30;n++){const im=ctx.getImageData(0,0,canvas.width,canvas.height);const qr=jsQR(im.data,im.width,im.height);if(!qr)break;results.push({page:i+1,text:qr.data});const pts=[qr.location.topLeftCorner,qr.location.topRightCorner,qr.location.bottomLeftCorner,qr.location.bottomRightCorner];const x=Math.min(...pts.map(p=>p.x))-8,y=Math.min(...pts.map(p=>p.y))-8;ctx.fillStyle="white";ctx.fillRect(x,y,Math.max(...pts.map(p=>p.x))-x+8,Math.max(...pts.map(p=>p.y))-y+8);}canvas.width=canvas.height=0;}});
    modal((box,close)=>{title(box,"QR codes",`${results.length} codes found`);for(const r of results){const p=document.createElement("p");p.textContent=`Page ${r.page}: ${r.text}`;box.append(p);buttons(box,[{label:"Copy text",onClick:()=>{void navigator.clipboard.writeText(r.text).catch(()=>toast("Select and copy the displayed text.","info"));}},...(/^https?:\/\//i.test(r.text)?[{label:"Open link",onClick:()=>{void this.app.platform.openExternal(r.text);}}]:[])]);}buttons(box,[{label:"Close",onClick:close}]);});
  }
  async qrStamp() {
    const o=await formDialog("Add QR code","Places a QR code on the current page.",[{key:"text",label:"Text or URL"}]);if(!o?.text)return;const QRCode=await import("qrcode");const data=await QRCode.toDataURL(o.text,{width:600,margin:4});const doc=await PDFDocument.load(await this.bytes());const image=await doc.embedPng(data);const page=doc.getPage(this.app.activeViewer.currentIndex);page.drawImage(image,{x:36,y:36,width:108,height:108});await this.open(await doc.save(),"QR");
  }
  async certificate() { const { signDialog } = await import("./sign"); const signed=await signDialog(await this.bytes()); if(signed) await this.app.platform.save(signed,"signed.pdf",undefined,true); }
  async editText() { const { replaceText }=await import("./textEdit");const o=await formDialog("Edit existing text","Edits text operators in standard Latin-font PDFs. Scans and embedded/custom encodings need a different editor; unsupported content is left unchanged.",[{key:"find",label:"Find exact text"},{key:"replace",label:"Replacement"}]);if(o){const result=await replaceText(await this.bytes(),o.find,o.replace);await this.open(result.bytes,`text edited (${result.count})`);} }
  async archive() { const { archivePdf }=await import("./archive");if(await confirmDialog("PDF/A archive copy","Creates a flattened, image-only PDF/A-2b archive copy. Searchable text and interactive content are removed. Validate with veraPDF before relying on archival compliance.","Create archive copy")) await this.open(await archivePdf(await this.bytes()),"archive"); }
}
