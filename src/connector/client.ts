import type { App } from "../app";
import { formDialog } from "../professional/forms";
import { confirmDialog, toast } from "../ui/dialogs";
import { extractPageText, Search } from "../viewer/search";
import { NativeSource } from "../platform/platform";
import { addAnnotation, deletePages, rotatePages, insertPages, uid, type Annotation } from "../edit/model";
import { buildPdf } from "../save/saver";
import { withPdf, renderPage } from "../professional/render";

export class Connector {
  private socket?:WebSocket;
  private busy=false;
  constructor(private app:App){}
  async toggle(){
    if(this.socket){this.socket.close();this.socket=undefined;toast("Claude connector disconnected.","info");return;}
    const o=await formDialog("Connect Claude", "Start the PDF Studio MCP server, then enter its pairing token. Claude can read this document while connected; that content is shared with your Claude conversation. Changes require approval here.",[{key:"token",label:"Pairing token",type:"password"}],"Connect");if(!o?.token)return;
    const socket=new WebSocket(`ws://127.0.0.1:32149/?token=${encodeURIComponent(o.token)}`);this.socket=socket;
    socket.onopen=()=>toast("Claude connector connected. Click Connector again to disconnect.","ok",8000);
    socket.onerror=()=>toast("Cannot connect. Check that the MCP server is running and the pairing token matches.","error");
    socket.onclose=()=>{if(this.socket===socket)this.socket=undefined;};
    socket.onmessage=event=>{void (async()=>{let request:{id:string;method:string;params:Record<string,unknown>};try{request=JSON.parse(String(event.data));if(this.busy)throw new Error("PDF Studio is handling another request.");this.busy=true;try{const result=await this.execute(request.method,request.params||{});if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:request.id,result}));}finally{this.busy=false;}}catch(e){let id;try{id=JSON.parse(String(event.data)).id;}catch{return;}if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id,error:(e as Error).message}));}})();};
  }
  async execute(method:string,p:Record<string,unknown>):Promise<unknown>{
    const app=this.app,state=app.history.state;
    if(method==="status")return{name:app.mainDoc?.source.name||null,pages:state.pages.length,currentPage:app.activeViewer.currentIndex+1,dirty:app.history.dirty};
    if(!app.mainDoc&&method!=="open")throw new Error("Open a PDF first.");
    const pageNumber=Number(p.page||1);if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>Math.max(1,state.pages.length))throw new Error("Page is out of range.");
    const ref=state.pages[pageNumber-1];
    if(method==="read_text"){const page=await app.store.getPage(ref);return{page:pageNumber,text:page?(await extractPageText(page)).text:""};}
    if(method==="search"){if(typeof p.query!=="string"||!p.query.trim())throw new Error("Enter a search query.");const search=new Search(app.store);await search.run(p.query,state.pages,0);return{matches:search.hits.slice(0,500).map(h=>({page:h.pageIndex+1,rects:h.rects})),total:search.hits.length};}
    if(method==="list_annotations")return{annotations:state.annotations.filter(a=>a.pageId===ref.id)};
    if(method==="metadata")return{metadata:await app.mainDoc!.pdf.getMetadata()};
    if(method==="read_forms")return{fields:Object.fromEntries(await app.mainDoc!.pdf.getFieldObjects()||[]),editedValues:state.formValues};
    if(method==="page_image"){const bytes=await buildPdf(state,app.store,app.images);return withPdf(bytes,async pdf=>{const{canvas}=await renderPage(pdf,pageNumber-1,72);const data=canvas.toDataURL("image/png").split(",")[1];canvas.width=canvas.height=0;return{mimeType:"image/png",data};});}
    if(!await confirmDialog("Claude requests an action",`${method}\n${JSON.stringify(p).slice(0,1500)}`,"Allow once"))throw new Error("The user declined this action.");
    switch(method){
      case "open":{if(typeof p.path!=="string"||!p.path.toLowerCase().endsWith(".pdf"))throw new Error("Provide a PDF path.");await app.openSources([await NativeSource.open(p.path)]);break;}
      case "navigate":app.activeViewer.scrollToPage(pageNumber-1);break;
      case "save":await app.save(true);break;
      case "merge":{if(typeof p.path!=="string"||!p.path.toLowerCase().endsWith(".pdf"))throw new Error("Provide a PDF path.");await app.openSources([await NativeSource.open(p.path)],"merge");break;}
      case "zoom":{const zoom=Number(p.scale);if(!Number.isFinite(zoom)||zoom<.1||zoom>8)throw new Error("Zoom must be 0.1–8.");app.activeViewer.setZoom(zoom);break;}
      case "split_view":app.toggleSplit();break;
      case "insert_blank":app.history.push(insertPages(state,pageNumber,[{id:uid("mcp-page"),docId:null,srcIndex:0,rotation:0,blank:{width:612,height:792}}]));break;
      case "fill_form":{const fields=await app.mainDoc!.pdf.getFieldObjects();if(typeof p.name!=="string"||!fields?.has(p.name))throw new Error("Unknown form field.");if(typeof p.value!=="string"&&typeof p.value!=="boolean")throw new Error("Form value must be text or boolean.");app.history.push({...state,formValues:{...state.formValues,[`${app.mainDoc!.id}|${p.name}`]:p.value}});break;}
      case "extract":{const indices=p.pages;if(!Array.isArray(indices)||!indices.length||indices.some(n=>!Number.isInteger(n)||n<1||n>state.pages.length))throw new Error("Provide valid page numbers.");const bytes=await buildPdf(state,app.store,app.images,{pages:indices.map(n=>state.pages[n-1])});await app.platform.save(bytes,"extracted.pdf",undefined,true);break;}
      case "ocr":await app.recognizeText();break;
      case "print":await app.print();break;
      case "shrink":await app.shrink();break;
      case "export_images":await app.exportImages();break;
      case "rotate":app.history.push(rotatePages(state,new Set([ref.id]),90));break;
      case "delete_page":app.history.push(deletePages(state,new Set([ref.id])));break;
      case "add_text":{const values=[p.x,p.y,p.width,p.height,p.fontSize].map(Number);if(!values.every(Number.isFinite)||values[2]<=0||values[3]<=0||values[4]<=0)throw new Error("Invalid text box dimensions.");const annotation:Annotation={id:uid("mcp"),pageId:ref.id,type:"text",box:{x:values[0],y:values[1],w:values[2],h:values[3],rot:0},text:String(p.text),fontSize:values[4],color:"#000000"};app.history.push(addAnnotation(state,annotation));break;}
      case "add_comment":app.history.push(addAnnotation(state,{id:uid("mcp"),pageId:ref.id,type:"note",x:72,y:720,text:String(p.text),color:"#ffcc00"}));break;
      case "add_box":case "redact":{const [x,y,w,h]=[p.x,p.y,p.width,p.height].map(Number);if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)throw new Error("Invalid rectangle.");app.history.push(addAnnotation(state,{id:uid("mcp"),pageId:ref.id,type:method==="redact"?"redact":"rect",box:{x,y,w,h,rot:0},color:method==="redact"?"#000000":"#e53935",opacity:1,strokeWidth:2}));break;}
      default:throw new Error("Unsupported connector action.");
    }
    return{ok:true};
  }
}
