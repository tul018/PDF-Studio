import * as Y from "yjs";
import type { App } from "../app";
import { BytesSource } from "../core/source";
import { buildPdf } from "../save/saver";
import { formDialog } from "../professional/forms";
import { modal, title, buttons, toast } from "../ui/dialogs";
import type { Annotation, PageRef, EditState, StoredImage } from "../edit/model";
import { answerInvite, PEER_PREFIX, PeerHub, type LiveSocket, type PeerRole } from "./peer";

export function base64(bytes:Uint8Array){let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function unbase64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export async function seal(bytes:Uint8Array,key:CryptoKey):Promise<string>{const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,bytes as BufferSource));const out=new Uint8Array(iv.length+data.length);out.set(iv);out.set(data,iv.length);return base64(out);}
export async function unseal(value:string,key:CryptoKey):Promise<Uint8Array>{const data=unbase64(value);return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:data.subarray(0,12)},key,data.subarray(12)));}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
async function invoke<T>(cmd: string): Promise<T> {
  return (await import("@tauri-apps/api/core")).invoke<T>(cmd);
}

/** Connect to the first address that answers (each tried for a few seconds). */
function firstOpen(urls: string[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return reject(new Error("Could not reach the host. Both PCs must be on the same network (or both in Tailscale), and the host's PDF Studio must still be hosting."));
      const ws = new WebSocket(urls[i++]);
      const timer = setTimeout(() => ws.close(), 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = ws.onclose = () => {
        clearTimeout(timer);
        ws.onopen = ws.onerror = ws.onclose = null;
        next();
      };
    };
    next();
  });
}

/** Yjs merges annotation/form edits by stable IDs. The relay sees only encrypted updates. */
export class LiveSession{
  private socket?:LiveSocket;private hub?:PeerHub;private stop?:()=>void;private doc?:Y.Doc;private incoming=Promise.resolve();private outgoing=Promise.resolve();
  constructor(private app:App){}
  private hosting=false;
  disconnect(){if(this.hosting&&isTauri){void invoke("relay_stop").catch(()=>{});}this.hosting=false;this.hub?.end();this.hub=undefined;this.stop?.();this.stop=undefined;this.socket?.close();this.socket=undefined;this.doc?.destroy();this.doc=undefined;document.body.classList.remove("live-view-only");}
  async toggle(){
    if(this.hub)return this.manageInvites();
    if(this.socket){this.disconnect();toast("Live session disconnected.","info");return;}
    const o=await formDialog("Work together live","Host over the internet: people anywhere join from inside the app - nothing to install, no account. You send each person an invitation code (e.g. by LINE), they send back a reply code. Same network: one code, for people on your Wi-Fi or office network (or anywhere with Tailscale). Everything is encrypted end to end.",[{key:"mode",label:"Session",options:["Host over the internet","Host on the same network","Join session"]},{key:"invite",label:"Invitation code (to join)"}],"Connect");if(!o)return;
    try{await this.connect(o.mode==="Join session"?"join":o.mode==="Host over the internet"?"internet":"network",o.invite);}catch(e){this.disconnect();toast((e as Error).message,"error",10000);}
  }

  /** Host over the internet: invite people one at a time (invitation code out, reply code back). */
  private manageInvites(){
    const hub=this.hub;if(!hub)return;
    modal((box,close)=>{
      title(box,"Invite people","For each person: 1) choose what they may do and send them the invitation code (e.g. by LINE); 2) paste the reply code they send back. Keep PDF Studio open: the session ends when you stop hosting.");
      const status=document.createElement("p");status.className="muted small live-status";box.append(status);
      const showCount=(n:number)=>status.textContent=n?`${n} ${n===1?"person":"people"} connected.`:"Nobody has joined yet.";
      showCount(hub.guests);hub.onPeersChange=(n)=>{showCount(n);};
      const step=document.createElement("div");step.className="live-invite";box.append(step);
      let cancel:(()=>void)|undefined;
      const start=async(role:PeerRole)=>{
        cancel?.();step.replaceChildren(Object.assign(document.createElement("p"),{className:"muted small",textContent:"Preparing the invitation…"}));
        try{
          const inv=await hub.invite(role);cancel=inv.cancel;step.replaceChildren();
          const l1=document.createElement("label");l1.className="pro-field";l1.append(`1. Send this ${role==="viewer"?"view-only":"editor"} invitation`);
          const code=document.createElement("textarea");code.readOnly=true;code.value=inv.code;code.className="modal-input live-code";code.setAttribute("aria-label","Invitation code to send");l1.append(code);
          const copy=document.createElement("button");copy.className="btn";copy.textContent="Copy invitation";copy.onclick=()=>{code.select();void navigator.clipboard?.writeText(inv.code).then(()=>toast("Invitation copied.","ok"),()=>document.execCommand("copy"));};
          const l2=document.createElement("label");l2.className="pro-field";l2.append("2. Paste their reply code");
          const reply=document.createElement("textarea");reply.className="modal-input live-code";reply.setAttribute("aria-label","Reply code");reply.placeholder="PS-…";l2.append(reply);
          const connect=document.createElement("button");connect.className="btn primary";connect.textContent="Connect";
          connect.onclick=async()=>{if(!reply.value.trim())return reply.focus();connect.disabled=true;connect.textContent="Connecting…";
            try{await inv.accept(reply.value);cancel=undefined;toast("Connected. They now see the document.","ok");step.replaceChildren(Object.assign(document.createElement("p"),{className:"small",textContent:"Connected. Invite someone else, or close this window."}));}
            catch(e){toast((e as Error).message,"error",12000);connect.disabled=false;connect.textContent="Connect";}};
          reply.addEventListener("keydown",e=>e.stopPropagation());
          step.append(l1,copy,l2,connect);code.select();
        }catch(e){step.replaceChildren();toast((e as Error).message,"error",10000);}
      };
      buttons(box,[
        {label:"Invite an editor",primary:true,onClick:()=>void start("editor")},
        {label:"Invite view-only",onClick:()=>void start("viewer")},
        {label:"End session",onClick:()=>{cancel?.();hub.onPeersChange=()=>{};close();this.disconnect();toast("Live session ended.","info");}},
        {label:"Close",onClick:()=>{cancel?.();hub.onPeersChange=()=>{};close();}},
      ]);
    });
  }

  /** Join over the internet: show the reply code to send back, and wait for the host to paste it. */
  private async joinPeer(code:string):Promise<{socket:LiveSocket;key:string}>{
    const busy=modal((box)=>{title(box,"Joining…","Preparing your reply code…");});
    let ans:Awaited<ReturnType<typeof answerInvite>>;
    try{ans=await answerInvite(code);}finally{busy();}
    let closeIt:()=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{closeIt=modal((box,close)=>{
      title(box,"Send this reply code to the host",`Copy the code below and send it back to the person who invited you. You'll be connected as soon as they paste it.`);
      const t=document.createElement("textarea");t.readOnly=true;t.value=ans.reply;t.className="modal-input live-code";t.setAttribute("aria-label","Reply code to send");box.append(t);
      const status=document.createElement("p");status.className="muted small";status.textContent="Waiting for the host…";box.append(status);
      buttons(box,[{label:"Copy reply code",primary:true,onClick:()=>{t.select();void navigator.clipboard?.writeText(ans.reply).then(()=>toast("Reply code copied.","ok"),()=>document.execCommand("copy"));}},{label:"Cancel",onClick:()=>{close();ans.cancel();reject(new Error("Joining cancelled."));}}]);
      requestAnimationFrame(()=>t.select());
    });});
    try{const c=await Promise.race([ans.connected,cancelled]);return {socket:c.socket,key:c.key};}
    finally{closeIt();}
  }

  async connect(mode:"internet"|"network"|"join",invitation:string){
    const host=mode!=="join";
    const peerJoin=!host&&invitation.trim().startsWith(PEER_PREFIX);
    // Desktop: the relay is built into the host's app. Browser/dev: a separately run relay.
    const fallback=import.meta.env.VITE_COLLAB_URL||"ws://127.0.0.1:32150";
    let hosts:string[]=[];let local=fallback;
    if(mode==="network"&&isTauri){const info=await invoke<{port:number;addresses:string[]}>("relay_start");this.hosting=true;local=`ws://127.0.0.1:${info.port}`;hosts=info.addresses;}
    let invite:{room:string;token:string;key:string;hosts?:string[]}|undefined;
    if(!host&&!peerJoin){try{invite=JSON.parse(atob(invitation.trim()));}catch{throw new Error("Invalid invitation code.");}if(!invite?.room||!invite.token||!invite.key)throw new Error("Invalid invitation code.");}
    if(host&&!this.app.mainDoc)throw new Error("Open a PDF first.");
    let joined:{socket:LiveSocket;key:string}|undefined;
    if(peerJoin)joined=await this.joinPeer(invitation);
    const rawKey=host?crypto.getRandomValues(new Uint8Array(32)):unbase64(joined?joined.key:invite!.key);
    const key=await crypto.subtle.importKey("raw",rawKey as BufferSource,"AES-GCM",false,["encrypt","decrypt"]);
    const bytes=host?await buildPdf(this.app.history.state,this.app.store,this.app.images):undefined;
    if(bytes&&bytes.length>12*1024*1024)throw new Error("Live sessions currently support PDFs up to 12 MB. Shrink a copy first.");
    let socket:LiveSocket;
    if(mode==="internet"){this.hub=new PeerHub(base64(rawKey),this.app.mainDoc!.source.name);socket=this.hub.hostSocket();}
    else if(joined)socket=joined.socket;
    else{const room=host?crypto.randomUUID():invite!.room;
      const urls=host?[local]:invite!.hosts?.length?invite!.hosts.map(h=>`ws://${h}`):[fallback];
      socket=(await firstOpen(urls.map(u=>{const a=new URL(u);a.searchParams.set("room",room);return a.toString();}))) as unknown as LiveSocket;}
    this.socket=socket;const doc=new Y.Doc();this.doc=doc;
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
    doc.on("update",(update:Uint8Array,origin:unknown)=>{if(origin==="remote")return;this.outgoing=this.outgoing.then(async()=>{const data=await seal(update,key);if(socket.readyState===1)socket.send(JSON.stringify({type:"update",data}));}).catch(e=>toast(e.message,"error"));});
    socket.send(JSON.stringify(host?{type:"create"}:invite?{type:"join",room:invite.room,token:invite.token}:{type:"join"}));
    socket.onmessage=event=>{this.incoming=this.incoming.then(async()=>{
      const message=JSON.parse(String(event.data));if(message.type==="error")throw new Error(message.message);
      if(message.type==="created"){
        await this.app.openSources([new BytesSource("Live — "+this.app.mainDoc!.source.name,bytes!)]);localDoc=this.app.mainDoc!.id;ready=true;
        doc.transact(()=>{metadata.set("pdf",base64(bytes!));metadata.set("name",this.app.mainDoc!.source.name);},"local");publish(this.app.history.state);undo.clear();
        if(this.hub){this.manageInvites();return;}
        const code=(token:string)=>btoa(JSON.stringify({room:message.room,token,key:base64(rawKey),hosts}));
        modal((box,close)=>{title(box,"Session is live",`Send an invitation (e.g. by LINE). Keep PDF Studio open: the session ends when you stop hosting. Others reach you at ${hosts.join(", ")||"this PC only"} - on the same network, or anywhere if both PCs use Tailscale. If Windows asks, allow PDF Studio on private networks.`);for(const[label,token]of [["Editor invitation",message.editor],["View-only invitation",message.viewer]]){const l=document.createElement("label");l.textContent=label;const t=document.createElement("textarea");t.readOnly=true;t.value=code(token);t.className="modal-input";l.append(t);box.append(l);}buttons(box,[{label:"Close",onClick:close}]);});
      }else if(message.type==="joined"){role=message.role;if(role==="viewer")document.body.classList.add("live-view-only");}
      else if(message.type==="update"){Y.applyUpdate(doc,await unseal(message.data,key),"remote");await apply();}
      else if(message.type==="closed"){this.disconnect();toast("The host ended this session.","info");}
    }).catch(e=>{toast(`Live session: ${e.message}`,"error",10000);this.disconnect();});};
    socket.onerror=()=>toast("The live connection was lost.","error");
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
