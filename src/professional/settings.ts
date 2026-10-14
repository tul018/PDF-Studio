import { formDialog } from "./forms";
import { toast } from "../ui/dialogs";
export async function advancedSettings(){
  const o=await formDialog("PDF engine settings","Native annotations remain editable in other PDF readers. Incremental save is available only for non-destructive changes to one unencrypted, unsigned source; other saves use a full rewrite. Rendering (graphics card or processor) is in Settings.",[
    {key:"native",label:"Save annotations",options:["Flatten into page","Native editable annotations"],value:localStorage.getItem("pdfstudio:nativeAnnotations")==="1"?"Native editable annotations":"Flatten into page"},
    {key:"incremental",label:"Incremental save",options:["Off","On"],value:localStorage.getItem("pdfstudio:incremental")==="1"?"On":"Off"},
  ]);
  if(!o)return;localStorage.setItem("pdfstudio:nativeAnnotations",o.native==="Native editable annotations"?"1":"0");localStorage.setItem("pdfstudio:incremental",o.incremental==="On"?"1":"0");toast("PDF engine settings saved.","ok");
}
