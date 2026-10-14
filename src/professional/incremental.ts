import { PDFDict, PDFDocument, PDFName, PDFNumber, type PDFObject } from "pdf-lib";
const encoder = new TextEncoder();
function serialize(object: PDFObject): Uint8Array { const bytes = new Uint8Array(object.sizeInBytes()); object.copyBytesInto(bytes, 0); return bytes; }
export function objectSnapshot(doc: PDFDocument, original: Uint8Array): Map<string, Uint8Array> {
  // The parser discards object/xref stream containers; their numbers are
  // still occupied in the previous revision and must never be reused.
  const tail = new TextDecoder("latin1").decode(original.slice(-65536));
  const offset = Number([...tail.matchAll(/startxref\s+(\d+)\s+%%EOF/g)].at(-1)?.[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= original.length) throw new Error("Invalid original cross-reference offset.");
  const header = new TextDecoder("latin1").decode(original.slice(offset, offset + 65536));
  const sizes = [...(tail + header).matchAll(/\/Size\s+(\d+)/g)].map(m => Number(m[1]));
  if (!sizes.length) throw new Error("Original PDF trailer size is unavailable.");
  const largest = Math.max(doc.context.largestObjectNumber, ...sizes.map(n => n - 1));
  if (!Number.isSafeInteger(largest) || largest > 2147483646) throw new Error("Invalid original object count.");
  doc.context.largestObjectNumber = largest;
  return new Map(doc.context.enumerateIndirectObjects().map(([ref,obj]) => [ref.tag, serialize(obj)]));
}
function same(a: Uint8Array | undefined, b: Uint8Array) { return !!a && a.length === b.length && a.every((v,i)=>v===b[i]); }

/** Append changed indirect objects and an xref section. Never use for removal/redaction. */
export async function saveIncremental(original: Uint8Array, doc: PDFDocument, before: Map<string, Uint8Array>): Promise<Uint8Array> {
  if (doc.context.trailerInfo.Encrypt) throw new Error("Incremental saving of encrypted PDFs is not supported.");
  if (doc.context.enumerateIndirectObjects().some(([,o])=>o instanceof PDFDict && o.get(PDFName.of("Type"))===PDFName.of("Sig"))) throw new Error("Use a signature-aware editor to update an already signed PDF.");
  const tail = new TextDecoder("latin1").decode(original.slice(-65536));
  const matches = [...tail.matchAll(/startxref\s+(\d+)\s+%%EOF/g)];
  const previous = matches.at(-1)?.[1]; if (!previous) throw new Error("Original PDF has no valid cross-reference pointer.");
  await doc.flush();
  const chunks = [original, encoder.encode("\n")]; let offset = original.length + 1;
  const entries: Array<{number:number;generation:number;offset:number}> = [];
  for (const [ref,object] of doc.context.enumerateIndirectObjects()) {
    const bytes=serialize(object); if(same(before.get(ref.tag),bytes))continue;
    entries.push({number:ref.objectNumber,generation:ref.generationNumber,offset});
    const head=encoder.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`),end=encoder.encode("\nendobj\n");
    chunks.push(head,bytes,end);offset+=head.length+bytes.length+end.length;
  }
  if(!entries.length)return original.slice();
  const xrefOffset=offset;
  let xref="xref\n";
  for(const entry of entries) xref+=`${entry.number} 1\n${String(entry.offset).padStart(10,"0")} ${String(entry.generation).padStart(5,"0")} n \n`;
  const trailer=doc.context.obj({Size:doc.context.largestObjectNumber+1,Root:doc.context.trailerInfo.Root,Info:doc.context.trailerInfo.Info,ID:doc.context.trailerInfo.ID,Prev:PDFNumber.of(+previous)});
  const ending=encoder.encode(`${xref}trailer\n${trailer.toString()}\nstartxref\n${xrefOffset}\n%%EOF\n`);chunks.push(ending);
  const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let pos=0;for(const c of chunks){out.set(c,pos);pos+=c.length;}return out;
}
