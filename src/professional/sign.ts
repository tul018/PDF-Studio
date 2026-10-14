import forge from "node-forge";
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from "pdf-lib";
import { formDialog } from "./forms";
function binary(bytes:Uint8Array){let out="";for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return out;}

export async function signPdf(bytes:Uint8Array, certificate:Uint8Array, password:string, reason:string):Promise<Uint8Array>{
  const p12=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(binary(certificate)),password);
  const keys=p12.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]||[];
  const plain=p12.getBags({bagType:forge.pki.oids.keyBag})[forge.pki.oids.keyBag]||[];
  const key=(keys[0]||plain[0])?.key as forge.pki.rsa.PrivateKey | undefined;
  if(!key)throw new Error("No supported RSA private key found in this certificate bundle.");
  const certs=(p12.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag]||[]).flatMap(b=>b.cert?[b.cert]:[]);
  const cert=certs.find(c=>{const pub=c.publicKey as forge.pki.rsa.PublicKey;return pub.n?.compareTo(key.n)===0&&pub.e?.compareTo(key.e)===0;});
  if(!cert)throw new Error("No matching signing certificate found.");
  const now=new Date();if(now<cert.validity.notBefore||now>cert.validity.notAfter)throw new Error("The signing certificate is not currently valid.");
  const doc=await PDFDocument.load(bytes,{updateMetadata:false});
  if(binary(bytes).includes("/ByteRange"))throw new Error("This file already has a signature. Adding a second signature is not supported.");
  const capacity=32768;
  const range=doc.context.obj([0,PDFName.of("**********"),PDFName.of("**********"),PDFName.of("**********")]);
  const sig=doc.context.register(doc.context.obj({Type:"Sig",Filter:"Adobe.PPKLite",SubFilter:"adbe.pkcs7.detached",ByteRange:range,Contents:PDFHexString.of("0".repeat(capacity*2)),M:PDFString.fromDate(now),Reason:PDFHexString.fromText(reason),Name:PDFHexString.fromText(cert.subject.getField("CN")?.value||"Signer")}));
  const page=doc.getPage(0);const widget=doc.context.register(doc.context.obj({Type:"Annot",Subtype:"Widget",FT:"Sig",T:PDFString.of(`Signature-${crypto.randomUUID()}`),Rect:[0,0,0,0],V:sig,P:page.ref,F:132}));
  page.node.addAnnot(widget);const form=doc.getForm().acroForm.dict;
  let fields=form.lookupMaybe(PDFName.of("Fields"),PDFArray);if(!fields){fields=doc.context.obj([]);form.set(PDFName.of("Fields"),fields);}fields.push(widget);form.set(PDFName.of("SigFlags"),PDFNumber.of(3));
  const output=await doc.save({useObjectStreams:false,updateFieldAppearances:false});const text=binary(output);
  const start=text.indexOf("<"+"0".repeat(capacity*2)+">");if(start<0)throw new Error("Signature placeholder missing.");const end=start+capacity*2+2;
  const placeholder=/\/ByteRange\s*\[\s*0\s*\/\*{10}\s*\/\*{10}\s*\/\*{10}\s*\]/.exec(text);if(!placeholder)throw new Error("Signature byte range missing.");
  const actual=`/ByteRange [0 ${start} ${end} ${output.length-end}]`;if(actual.length>placeholder[0].length)throw new Error("PDF too large to sign.");output.set(new TextEncoder().encode(actual.padEnd(placeholder[0].length," ")),placeholder.index);
  const content=binary(output.subarray(0,start))+binary(output.subarray(end));
  const message=forge.pkcs7.createSignedData();message.content=forge.util.createBuffer(content);for(const c of certs)message.addCertificate(c);
  message.addSigner({key,certificate:cert,digestAlgorithm:forge.pki.oids.sha256,authenticatedAttributes:[{type:forge.pki.oids.contentType,value:forge.pki.oids.data},{type:forge.pki.oids.messageDigest},{type:forge.pki.oids.signingTime,value:now as unknown as string}]});message.sign({detached:true});
  const signature=forge.util.bytesToHex(forge.asn1.toDer(message.toAsn1()).getBytes());if(signature.length>capacity*2)throw new Error("Certificate chain exceeds signature capacity.");
  output.set(new TextEncoder().encode(signature.padEnd(capacity*2,"0")),start+1);return output;
}
export async function signDialog(bytes:Uint8Array):Promise<Uint8Array|null>{
  const input=document.createElement("input");input.type="file";input.accept=".p12,.pfx";
  const file=await new Promise<File|null>(resolve=>{input.onchange=()=>resolve(input.files?.[0]||null);input.oncancel=()=>resolve(null);input.click();});if(!file)return null;
  const o=await formDialog("Sign with certificate","The RSA certificate and password stay on this device. This creates a detached certificate signature, without a trusted timestamp or long-term validation. Save the signed copy without editing it afterward.",[{key:"password",label:"Certificate password",type:"password"},{key:"reason",label:"Reason for signing"}],"Sign copy");if(!o)return null;
  const cert=new Uint8Array(await file.arrayBuffer());try{return await signPdf(bytes,cert,o.password,o.reason);}finally{cert.fill(0);o.password="";}
}
