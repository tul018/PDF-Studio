import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";

interface Token { raw:string; start:number; end:number; string:boolean }
function tokenize(source:string):Token[]{
  const out:Token[]=[];let i=0;
  while(i<source.length){if(/\s/.test(source[i])){i++;continue;}if(source[i]==="%"){while(i<source.length&&!/[\r\n]/.test(source[i]))i++;continue;}
    const start=i;let string=false;
    if(source[i]==="("){string=true;let depth=1;i++;while(i<source.length&&depth){if(source[i]==="\\"){i+=2;continue;}if(source[i]==="(")depth++;else if(source[i]===")")depth--;i++;}if(depth)throw new Error("Malformed literal string in page content.");}
    else if(source[i]==="<"&&source[i+1]!=="<"){string=true;const end=source.indexOf(">",i+1);if(end<0)throw new Error("Malformed hex string in page content.");i=end+1;}
    else if("[]<>".includes(source[i]))i++;
    else {i++;while(i<source.length&&!/[\s\[\]()<>/%]/.test(source[i]))i++;}
    out.push({raw:source.slice(start,i),start,end:i,string});
  }
  return out;
}

/** Conservative text-operator replacement for standard-font text runs. */
export async function replaceText(bytes:Uint8Array,find:string,replacement:string):Promise<{bytes:Uint8Array;count:number}>{
  if(!find||/[^\x20-\x7e]/.test(find+replacement))throw new Error("This editor supports printable Latin text. Enter non-empty text to find.");
  const doc=await PDFDocument.load(bytes,{updateMetadata:false});let count=0;
  for(const page of doc.getPages()){
    const fonts=page.node.Resources()?.lookupMaybe(PDFName.of("Font"),PDFDict);if(!fonts)continue;
    const supported=new Set<string>();for(const [key,value]of fonts.entries()){const font=doc.context.lookup(value);if(!(font instanceof PDFDict))continue;
      const name=font.get(PDFName.of("BaseFont"))?.toString()||"";const encoding=font.get(PDFName.of("Encoding"));
      if(/^\/(Helvetica|Times|Courier)(-|$)/.test(name)&&(!encoding||encoding===PDFName.of("WinAnsiEncoding"))&&!font.has(PDFName.of("ToUnicode")))supported.add(key.toString());
    }
    let contents=page.node.Contents();const streams=contents instanceof PDFArray?contents.asArray():contents?[contents]:[];const updated=[];let font="";
    for(const ref of streams){const stream=doc.context.lookup(ref);if(!(stream instanceof PDFRawStream)){updated.push(ref);continue;}
      const raw=decodePDFRawStream(stream).decode();let source="";for(const b of raw)source+=String.fromCharCode(b);
      // Inline image streams are left alone: binary image bytes are not text operators.
      if(/(?:^|\s)BI(?:\s|$)/.test(source)){updated.push(ref);continue;}
      const tokens=tokenize(source),changes:Array<{start:number;end:number;value:string}>=[];
      const replace=(t:Token|undefined)=>{if(!t?.string||!supported.has(font))return;const decoded=t.raw.startsWith("(")?PDFString.of(t.raw.slice(1,-1)).decodeText():PDFHexString.of(t.raw.slice(1,-1).replace(/\s/g,"")).decodeText();if(/[^\x20-\x7e]/.test(decoded)||!decoded.includes(find))return;count+=decoded.split(find).length-1;const value=decoded.split(find).join(replacement);changes.push({start:t.start,end:t.end,value:"<"+Array.from(value,c=>c.charCodeAt(0).toString(16).padStart(2,"0")).join("")+">"});};
      tokens.forEach((token,i)=>{if(token.string)return;if(token.raw==="Tf")font=tokens[i-2]?.raw||"";if(["Tj","'",'"'].includes(token.raw))replace(tokens[i-1]);if(token.raw==="TJ"){let first=i-1;while(first>=0&&tokens[first].raw!=="[")first--;if(first>=0)for(let j=first+1;j<i-1;j++)replace(tokens[j]);}});
      let result=source;for(const change of changes.sort((a,b)=>b.start-a.start))result=result.slice(0,change.start)+change.value+result.slice(change.end);
      updated.push(changes.length?doc.context.register(doc.context.flateStream(Uint8Array.from(result,c=>c.charCodeAt(0)))):ref);
    }
    page.node.set(PDFName.of("Contents"),doc.context.obj(updated));
  }
  if(!count)throw new Error("No editable match found. Standard Latin-font text runs are supported; this PDF may use embedded fonts, a phrase split across runs or scanned images.");
  return{bytes:await doc.save(),count};
}
