import { it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { replaceText } from "../../src/professional/textEdit";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

it("replaces hex and escaped literal runs in text arrays while preserving other content",async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage(),font=await doc.embedFont(StandardFonts.Helvetica);
 const name=page.node.newFontDictionary("F",font.ref);
 page.node.addContentStream(doc.context.register(doc.context.flateStream(`BT ${name} 12 Tf 50 700 Td [<4f6c64> -10 ( price)] TJ 0 -20 Td (Old \\(sale\\)) Tj ET`)));
 const result=await replaceText(await doc.save(),"Old","New");expect(result.count).toBe(2);
 const task=getDocument({data:result.bytes,standardFontDataUrl:"node_modules/pdfjs-dist/standard_fonts/"});
 try{const pdf=await task.promise;const text=(await(await pdf.getPage(1)).getTextContent()).items.flatMap(i=>"str"in i?[i.str]:[]).join(" ");expect(text).toContain("New price");expect(text).toContain("New (sale)");expect(text).not.toContain("Old");}finally{await task.destroy();}
});
