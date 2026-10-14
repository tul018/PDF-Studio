import * as Y from "yjs";
import type { App } from "../app";
import { BytesSource } from "../core/source";
import { buildPdf } from "../save/saver";
import { formDialog } from "../professional/forms";
import { modal, title, buttons, toast } from "../ui/dialogs";
import type { Annotation, PageRef, EditState, StoredImage } from "../edit/model";

export function base64(bytes:Uint8Array){let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function unbase64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export async function seal(bytes:Uint8Array,key:CryptoKey):Promise<string>{const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,bytes as BufferSource));const out=new Uint8Array(iv.length+data.length);out.set(iv);out.set(data,iv.length);return base64(out);}
export async function unseal(value:string,key:CryptoKey):Promise<Uint8Array>{const data=unbase64(value);return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:data.subarray(0,12)},key,data.subarray(12)));}

/** Yjs merges annotation/form edits by stable IDs. The relay sees only encrypted updates. */
export class LiveSession{
  private socket?:WebSocket;private stop?:()=>void;private doc?:Y.Doc;private incoming=Promise.resolve();private outgoing=Promise.resolve();
  constructor(private app:App){}
  disconnect(){this.stop?.();this.stop=undefined;this.socket?.close();this.socket=undefined;this.doc?.destroy();this.doc=undefined;document.body.classList.remove("live-view-only");}
  async toggle(){if(this.socket){this.disconnect();toast("Live session disconnected.","info");return;}
    const o=await formDialog("Work together live","Run npm run collaboration for a local session. Documents and changes are encrypted before being relayed. Share the invitation only with people who may see the document.",[{key:"mode",label:"Session",options:["Host current PDF","Join session"]},{key:"invite",label:"Invitation code (to join)"}],"Connect");if(!o)return;
    try{await this.connect(o.mode==="Host current PDF",o.invite);}catch(e){this.disconnect();toast((e as Error).message,"error",10000);}
  }
  async connect(host:boolean,invitation:string){
    const endpoint=import.meta.env.VITE_COLLAB_URL||"ws://127.0.0.1:32150";
    let invite:{room:string;token:string;key:string}|undefined;
    if(!host){try{invite=JSON.parse(atob(invitation.trim()));}catch{throw new Error("Invalid invitation code.");}if(!invite?.room||!invite.token||!invite.key)throw new Error("Invalid invitation code.");}
    if(host&&!this.app.mainDoc)throw new Error("Open a PDF first.");
    const rawKey=host?crypto.getRandomValues(new Uint8Array(32)):unbase64(invite!.key);
    const key=await crypto.subtle.importKey("raw",rawKey as BufferSource,"AES-GCM",false,["encrypt","decrypt"]);
    const bytes=host?await buildPdf(this.app.history.state,this.app.store,this.app.images):undefined;
    if(bytes&&bytes.length>12*1024*1024)throw new Error("Live sessions currently support PDFs up to 12 MB. Shrink a copy first.");
    const room=host?crypto.randomUUID():invite!.room;
    const address=new URL(endpoint);address.searchParams.set("room",room);
    const socket=new WebSocket(address);this.socket=socket;const doc=new Y.Doc();this.doc=doc;
    const metadata=doc.getMap<string>("document"),annots=doc.getMap<string>("annotations"),pages=doc.getMap<string>("pages"),order=doc.getArray<string>("order"),values=doc.getMap<string>("forms"),images=doc.getMap<string>("images");
    let localDoc="",applying=false,ready=false,role="editor",boundPageIds=new Set<string>();
    let previous:EditState|undefined;
    const undo=new Y.UndoManager([annots,pages,order,values,images],{trackedOrigins:new Set(["local"]),captureTimeout:0});
    const publish=(state:EditState)=>{
      if(!ready||applying||role==="viewer")return;
      if(state.pages.some(p=>p.docId&&p.docId!==localDoc)){toast("Live sharing paused: merging another source is not supported in this session.","info");return;}
      doc.transact(()=>{
        const update=(map:Y.Map<string>,entries:Array<[string,string]>)=>{const keys=new Set(entries.map(([k])=>k));for(const k of [...map.keys()])if(!keys.has(k))map.delete(k);for(const[k,v]of entries)if(map.get(k)!==v)map.set(k,v);};
        if(!previous||state.pages!==previous.pages){update(pages,state.pages.map(p=>[p.id,JSON.stringify({...p,docId:p.docId?"shared":null})]));
          const ids=state.pages.map(p=>p.id);let current=order.toArray();for(let i=current.length-1;i>=0;i--)if(!ids.includes(current[i]))order.delete(i,1);
          for(let i=0;i<ids.length;i++){current=order.toArray();if(current[i]===ids[i])continue;const old=current.indexOf(ids[i]);if(old>=0)order.delete(old,1);order.insert(i,[ids[i]]);}}
        if(!previous||state.annotations!==previous.annotations)update(annots,state.annotations.map(a=>[a.id,JSON.stringify(a)]));
        if(!previous||state.formValues!==previous.formValues)update(values,Object.entries(state.formValues).map(([k,v])=>[k.replace(localDoc+"|","shared|"),JSON.stringify(v)]));
        for(const a of state.annotations)if(a.type==="image"&&!images.has(a.imageId)){const im=this.app.images.get(a.imageId);if(im)images.set(a.imageId,JSON.stringify({bytes:base64(im.bytes),mime:im.mime,width:im.width,height:im.height}));}
      },"local");previous=state;boundPageIds=new Set(state.pages.map(p=>p.id));
    };
    const apply=async()=>{
      if(!metadata.get("pdf"))return;
      applying=true;
      try{if(!ready){await this.app.openSources([new BytesSource(metadata.get("name")||"Live.pdf",unbase64(metadata.get("pdf")!))]);localDoc=this.app.mainDoc!.id;ready=true;}
        const ids=[...new Set(order.toArray())].filter(id=>pages.has(id));
        const nextPages=ids.map(id=>({...JSON.parse(pages.get(id)!) as PageRef,docId:JSON.parse(pages.get(id)!).docId?localDoc:null}));
        if(!nextPages.length)return;
        for(const[id,json]of images){if(this.app.images.has(id))continue;const im=JSON.parse(json);const data=unbase64(im.bytes);this.app.images.set(id,{...im,bytes:data,url:URL.createObjectURL(new Blob([data],{type:im.mime}))} as StoredImage);}
        const next:EditState={pages:nextPages,annotations:[...annots.values()].map(v=>JSON.parse(v) as Annotation).filter(a=>ids.includes(a.pageId)),formValues:Object.fromEntries([...values].map(([k,v])=>[k.replace("shared|",localDoc+"|"),JSON.parse(v)]))};
        previous=next;boundPageIds=new Set(ids);this.app.history.replace(next);
      }finally{applying=false;}
    };
    doc.on("update",(update:Uint8Array,origin:unknown)=>{if(origin==="remote")return;this.outgoing=this.outgoing.then(async()=>{const data=await seal(update,key);if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"update",data}));}).catch(e=>toast(e.message,"error"));});
    socket.onopen=()=>socket.send(JSON.stringify(host?{type:"create"}:{type:"join",room:invite!.room,token:invite!.token}));
    socket.onmessage=event=>{this.incoming=this.incoming.then(async()=>{
      const message=JSON.parse(String(event.data));if(message.type==="error")throw new Error(message.message);
      if(message.type==="created"){
        await this.app.openSources([new BytesSource("Live — "+this.app.mainDoc!.source.name,bytes!)]);localDoc=this.app.mainDoc!.id;ready=true;
        doc.transact(()=>{metadata.set("pdf",base64(bytes!));metadata.set("name",this.app.mainDoc!.source.name);},"local");publish(this.app.history.state);undo.clear();
        const code=(token:string)=>btoa(JSON.stringify({room:message.room,token,key:base64(rawKey)}));
        modal((box,close)=>{title(box,"Session is live","Keep this app and the relay running. Invitations expire when the host disconnects.");for(const[label,token]of [["Editor invitation",message.editor],["View-only invitation",message.viewer]]){const l=document.createElement("label");l.textContent=label;const t=document.createElement("textarea");t.readOnly=true;t.value=code(token);t.className="modal-input";l.append(t);box.append(l);}buttons(box,[{label:"Close",onClick:close}]);});
      }else if(message.type==="joined"){role=message.role;if(role==="viewer")document.body.classList.add("live-view-only");}
      else if(message.type==="update"){Y.applyUpdate(doc,await unseal(message.data,key),"remote");await apply();}
      else if(message.type==="closed"){this.disconnect();toast("The host ended this session.","info");}
    }).catch(e=>{toast(`Live session: ${e.message}`,"error",10000);this.disconnect();});};
    socket.onerror=()=>toast("Live relay is unavailable. Start npm run collaboration or configure a hosted relay.","error");
    socket.onclose=()=>{if(this.socket===socket)this.disconnect();};
    this.app.history.externalUndo={canUndo:()=>role!=="viewer"&&undo.canUndo(),canRedo:()=>role!=="viewer"&&undo.canRedo(),undo:()=>{if(role!=="viewer"){undo.undo();void apply();}},redo:()=>{if(role!=="viewer"){undo.redo();void apply();}}};
    const unsubscribe=this.app.history.subscribe(state=>{
      if(applying||!ready)return;
      if(state.pages.some(p=>p.docId&&p.docId!==localDoc)||(!state.pages.some(p=>boundPageIds.has(p.id))&&state.pages.length)){this.disconnect();toast("Live session ended because the document changed.","info");return;}
      if(role==="viewer"){void apply();return;}publish(state);
    });
    this.stop=()=>{unsubscribe();this.app.history.externalUndo=undefined;undo.destroy();};
  }
}
