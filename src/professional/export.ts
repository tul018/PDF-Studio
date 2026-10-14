import { pageLines } from "./render";

export async function exportWord(bytes: Uint8Array): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const pages = await pageLines(bytes);
  const doc = new Document({ sections: pages.map(lines => ({ children: lines.length ? lines.map(text => new Paragraph({ children: [new TextRun(text)] })) : [new Paragraph("[No text: run OCR on this page before exporting]")] })) });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
export async function exportExcel(bytes: Uint8Array): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  const pages = await pageLines(bytes), ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const xml = (s:string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const files:Record<string,Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${pages.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  files["_rels/.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${pages.map((_,i)=>`<sheet name="Page ${i+1}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pages.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}</Relationships>`);
  pages.forEach((lines,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=strToU8(`<worksheet xmlns="${ns}"><cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="100" customWidth="1"/></cols><sheetData>${["Text",...lines].map((text,n)=>`<row r="${n+1}"><c r="A${n+1}" t="inlineStr"><is><t>${n||"Line"}</t></is></c><c r="B${n+1}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c></row>`).join("")}</sheetData></worksheet>`);});
  return zipSync(files);
}
