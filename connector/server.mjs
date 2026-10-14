import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const token = process.env.PDF_STUDIO_PAIRING_TOKEN || (process.env.PDF_STUDIO_PAIRING_FILE ? readFileSync(process.env.PDF_STUDIO_PAIRING_FILE,'utf8').trim() : randomBytes(32).toString('hex'));
if(token.length<32)throw new Error('Use a random pairing token of at least 32 characters.');
if(!process.env.PDF_STUDIO_PAIRING_TOKEN&&!process.env.PDF_STUDIO_PAIRING_FILE)console.error(`PDF Studio pairing token (enter in the Connector dialog): ${token}`);
let client; let next=0; const pending=new Map();
const wss=new WebSocketServer({host:'127.0.0.1',port:32149,maxPayload:8*1024*1024,verifyClient:({req},done)=>{
  const candidate=new URL(req.url,'http://127.0.0.1').searchParams.get('token')||'';
  const origin=req.headers.origin||''; const allowed=/^(http:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/.test(origin);
  const supplied=Buffer.from(candidate),expected=Buffer.from(token);
  done(allowed&&supplied.length===expected.length&&timingSafeEqual(supplied,expected),401);
}});
wss.on('connection',socket=>{if(client){socket.close(1008,'Already paired');return;}client=socket;
  socket.on('message',data=>{try{const m=JSON.parse(String(data));const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(String(m.error))):p.resolve(m.result);}catch{socket.close(1008,'Invalid response');}});
  socket.on('close',()=>{client=undefined;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('PDF Studio disconnected.'));}pending.clear();});
});
function call(method,params){if(!client)return Promise.reject(new Error('PDF Studio is not connected. Open Connector in the app and pair it with this server.'));return new Promise((resolve,reject)=>{const id=String(++next);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timed out waiting for PDF Studio or user approval.'));},120000);pending.set(id,{resolve,reject,timer});client.send(JSON.stringify({id,method,params}));});}
const server=new McpServer({name:'pdf-studio-mcp-server',version:'0.2.0'});
const page=z.number().int().min(1).describe('One-based page number');
const definitions=[
 ['status','Read the open document name, page count, current page and unsaved-edit status.',{},true],
 ['read_text','Read extracted text from one page. Scans must be recognized with OCR first.',{page},true],
 ['search','Find a literal phrase. Returns at most 500 matches with page numbers and rectangles.',{query:z.string().min(1).max(500)},true],
 ['page_image','Render one page as a PNG for visual inspection.',{page},true],
 ['metadata','Read document metadata.',{},true],
 ['read_forms','List form fields and current edited values.',{},true],
 ['list_annotations','List annotations added in this session on one page.',{page},true],
 ['open','Open a local PDF after the user approves in PDF Studio.',{path:z.string().min(1).max(4096)},false],
 ['navigate','Navigate to a page after approval.',{page},false],
 ['save','Open Save As after approval. The user chooses the destination.',{},false],
 ['merge','Add pages from another local PDF after approval.',{path:z.string().min(1).max(4096)},false],
 ['zoom','Set zoom after approval: 1 means 100 percent.',{scale:z.number().min(.1).max(8)},false],
 ['split_view','Toggle a second view of the current PDF after approval.',{},false],
 ['insert_blank','Insert a blank letter-size page after the specified page, after approval.',{page},false],
 ['extract','Save the specified pages as a new PDF after approval.',{pages:z.array(page).min(1).max(10000)},false],
 ['fill_form','Set a named form field after approval.',{name:z.string().min(1).max(1000),value:z.union([z.string().max(20000),z.boolean()])},false],
 ['ocr','Open the OCR dialog. The user chooses language/pages and confirms.',{},false],
 ['print','Open the print workflow after approval. The user confirms printing.',{},false],
 ['shrink','Open the compression dialog after approval.',{},false],
 ['export_images','Open the page image export dialog after approval.',{},false],
 ['rotate','Rotate one page clockwise 90 degrees after approval.',{page},false],
 ['delete_page','Delete one page after approval. Undoable until saved; cannot delete the final page.',{page},false],
 ['add_text','Add a text annotation in PDF point coordinates after approval.',{page,text:z.string().max(20000),x:z.number().finite(),y:z.number().finite(),width:z.number().positive(),height:z.number().positive(),fontSize:z.number().positive().max(300)},false],
 ['add_comment','Add a sticky-note comment after approval.',{page,text:z.string().min(1).max(20000)},false],
 ['add_box','Add a rectangular annotation after approval.',{page,x:z.number().finite(),y:z.number().finite(),width:z.number().positive(),height:z.number().positive()},false],
 ['redact','Mark a rectangle for true redaction after approval. Review before saving; saving removes underlying content.',{page,x:z.number().finite(),y:z.number().finite(),width:z.number().positive(),height:z.number().positive()},false],
];
for(const[method,description,inputSchema,readOnlyHint]of definitions)server.registerTool(`pdf_${method}`,{title:method.replaceAll('_',' '),description,inputSchema,annotations:{readOnlyHint,destructiveHint:method==='delete_page',idempotentHint:readOnlyHint,openWorldHint:false}},async params=>{
  try{const result=await call(method,params);if(method==='page_image')return{content:[{type:'image',mimeType:result.mimeType,data:result.data}]};return{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
  catch(e){return{isError:true,content:[{type:'text',text:e.message}]};}
});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>{client?.close();wss.close();});
