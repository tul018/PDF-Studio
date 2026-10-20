import { PDFDocument, PDFHexString, type PDFPage } from "pdf-lib";
import { rotVec, type Annotation } from "../edit/model";

/** Attach an editable annotation with a self-contained appearance stream. */
export async function nativeAnnotation(doc: PDFDocument, page: PDFPage, a: Annotation, draw: (appearance: PDFPage) => Promise<void>): Promise<boolean> {
  if(a.type==="redact" || a.type==="whiteout" || a.type==="note")return false;
  let bounds:number[];
  if("box" in a){const b=a.box;const corners=[[0,0],[b.w,0],[0,b.h],[b.w,b.h]].map(([x,y])=>{const v=rotVec(b.rot,x,y);return [b.x+v[0],b.y+v[1]];});bounds=[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];}
  else if(a.type==="ink")bounds=[Math.min(...a.points.filter((_,i)=>i%2===0)),Math.min(...a.points.filter((_,i)=>i%2===1)),Math.max(...a.points.filter((_,i)=>i%2===0)),Math.max(...a.points.filter((_,i)=>i%2===1))];
  else bounds=[Math.min(a.x1,a.x2),Math.min(a.y1,a.y2),Math.max(a.x1,a.x2),Math.max(a.y1,a.y2)];
  bounds=[bounds[0]-8,bounds[1]-8,bounds[2]+8,bounds[3]+8];
  if(!bounds.every(Number.isFinite))return false;
  const temp=doc.addPage([page.getWidth(),page.getHeight()]);
  let appearance;
  try{await draw(temp);appearance=await doc.embedPage(temp,{left:bounds[0],bottom:bounds[1],right:bounds[2],top:bounds[3]});await appearance.embed();}
  finally{doc.removePage(doc.getPageCount()-1);}
  const subtype={highlight:"Highlight",rect:"Square",ellipse:"Circle",cloud:"Square",ink:"Ink",line:"Line",arrow:"Line",text:"FreeText",image:"Stamp"}[a.type];
  const color="color" in a?a.color:"#000000";const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
  const data:Record<string,any>={Type:"Annot",Subtype:subtype,Rect:bounds,NM:PDFHexString.fromText(a.id),F:4,C:c,AP:{N:appearance!.ref},Contents:PDFHexString.fromText(a.type==="text"?a.text:""),P:page.ref};
  if(a.type==="ink")data.InkList=[a.points];
  if(a.type==="cloud")data.BE={S:"C",I:1};
  if(a.type==="line"||a.type==="arrow"){data.L=[a.x1,a.y1,a.x2,a.y2];data.LE=["None",a.type==="arrow"?"OpenArrow":"None"];}
  if(a.type==="highlight"){const b=a.box;const points=[[0,b.h],[b.w,b.h],[0,0],[b.w,0]].flatMap(([x,y])=>{const v=rotVec(b.rot,x,y);return[b.x+v[0],b.y+v[1]];});data.QuadPoints=points;}
  if(a.type==="text")data.DA=PDFHexString.fromText(`0 g /${({serif:"TiRo",mono:"Cour"} as Record<string,string>)[a.font??""]??"Helv"} ${a.fontSize} Tf`);
  page.node.addAnnot(doc.context.register(doc.context.obj(data)));return true;
}
