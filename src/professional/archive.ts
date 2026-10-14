import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { sanitizedCopy } from "./render";
export async function archivePdf(bytes:Uint8Array):Promise<Uint8Array>{
  const response=await fetch(new URL("color/sRGB.icc",document.baseURI));if(!response.ok)throw new Error("The bundled sRGB profile is missing.");
  const profile=new Uint8Array(await response.arrayBuffer());
  const doc=await PDFDocument.load(await sanitizedCopy(bytes),{updateMetadata:false});
  const icc=doc.context.register(doc.context.stream(profile,{N:3}));
  const intent=doc.context.register(doc.context.obj({Type:"OutputIntent",S:"GTS_PDFA1",OutputConditionIdentifier:PDFString.of("sRGB"),Info:PDFString.of("sRGB IEC61966-2.1"),RegistryName:PDFString.of("http://www.color.org"),DestOutputProfile:icc}));
  doc.catalog.set(PDFName.of("OutputIntents"),doc.context.obj([intent]));
  const xmp=`<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  doc.catalog.set(PDFName.of("Metadata"),doc.context.register(doc.context.stream(new TextEncoder().encode(xmp),{Type:"Metadata",Subtype:"XML"})));
  const id=PDFHexString.of(crypto.randomUUID().replaceAll("-",""));doc.context.trailerInfo.ID=doc.context.obj([id,id]);doc.context.trailerInfo.Info=undefined;
  return doc.save({useObjectStreams:false});
}
