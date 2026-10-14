import { isTauri } from "./platform";
import { confirmDialog, toast, progressOverlay } from "../ui/dialogs";
import { formDialog } from "../professional/forms";

export async function updateSettings(dirty:()=>boolean) {
  const configured=import.meta.env.VITE_UPDATES_CONFIGURED==="1";
  const o=await formDialog("App updates",configured?"Update packages must pass signature verification before installation.":"Update hosting has not been configured. This build will not contact an update server.",[{key:"automatic",label:"Check when PDF Studio starts",options:["Off","On"],value:localStorage.getItem("pdfstudio:autoUpdates")==="1"?"On":"Off"}],"Save and check");
  if(!o)return;localStorage.setItem("pdfstudio:autoUpdates",o.automatic==="On"?"1":"0");await checkUpdates(dirty,true);
}
export async function checkUpdates(dirty:()=>boolean,manual=false){
  if(!isTauri||import.meta.env.VITE_UPDATES_CONFIGURED!=="1"){if(manual)toast("Updates are not configured for this build.","info");return;}
  if(!manual&&localStorage.getItem("pdfstudio:autoUpdates")!=="1")return;
  try{const {check}=await import("@tauri-apps/plugin-updater");const update=await check({timeout:15000});if(!update){if(manual)toast("You have the latest version.","ok");return;}
    try{if(dirty()){toast(`Version ${update.version} is available. Save your edits before installing.`,"info",10000);return;}
      if(!await confirmDialog(`Update to ${update.version}`,update.body||"A new signed release is available. The app will close during installation.","Download and install"))return;
      const busy=progressOverlay("Downloading update");let loaded=0,total=0;
      try{await update.download(event=>{if(event.event==="Started")total=event.data.contentLength||0;else if(event.event==="Progress")loaded+=event.data.chunkLength;busy.update("Downloading update",total?loaded/total:0);});if(dirty())throw new Error("Edits changed while downloading. Save them and check for updates again.");await update.install();}finally{busy.close();}
    }finally{await update.close();}
  }catch(e){if(manual)toast(`Update check failed: ${(e as Error).message}`,"error",10000);}
}
