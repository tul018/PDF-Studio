import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from "pdf-lib";
import { parseCalc, parseFormat, type FormScripts } from "./calc";

/** The text of a JavaScript action (a string or a stream), or "". */
function jsOf(doc: PDFDocument, action: unknown): string {
  const a = action instanceof PDFRef ? doc.context.lookup(action) : action;
  if (!(a instanceof PDFDict)) return "";
  const js = a.lookup(PDFName.of("JS"));
  if (js instanceof PDFString || js instanceof PDFHexString) return js.decodeText();
  if (js instanceof PDFRawStream) return new TextDecoder("latin1").decode(decodePDFRawStream(js).decode());
  return "";
}

/**
 * The calculate and number-format scripts of a form, read from the file
 * (PDF.js doesn't hand them over without its scripting sandbox). Null when
 * the file has no form or can't be read (e.g. encrypted).
 */
export async function readFormScripts(bytes: Uint8Array): Promise<FormScripts | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (!doc.catalog.has(PDFName.of("AcroForm"))) return null;
    const form = doc.getForm();
    const scripts: FormScripts = { order: [], calc: new Map(), format: new Map() };
    const byRef = new Map<string, string>();
    const inOrder: string[] = [];
    for (const f of form.getFields()) {
      const name = f.getName();
      byRef.set(f.ref.toString(), name);
      // The field's own /AA, or a widget's (Acrobat writes either).
      const dicts = [f.acroField.dict, ...f.acroField.getWidgets().map((w) => w.dict)];
      for (const d of dicts) {
        const aa = d.lookup(PDFName.of("AA"));
        if (!(aa instanceof PDFDict)) continue;
        const calc = parseCalc(jsOf(doc, aa.get(PDFName.of("C"))));
        if (calc && !scripts.calc.has(name)) {
          scripts.calc.set(name, calc);
          inOrder.push(name);
        }
        const fmt = parseFormat(jsOf(doc, aa.get(PDFName.of("F"))));
        if (fmt && !scripts.format.has(name)) scripts.format.set(name, fmt);
      }
    }
    // The form's calculation order (/CO) first, then any others in file order.
    const co = form.acroForm.dict.lookup(PDFName.of("CO"));
    if (co instanceof PDFArray) {
      for (const r of co.asArray()) {
        const n = byRef.get(r.toString());
        if (n && scripts.calc.has(n) && !scripts.order.includes(n)) scripts.order.push(n);
      }
    }
    for (const n of inOrder) if (!scripts.order.includes(n)) scripts.order.push(n);
    return scripts.calc.size || scripts.format.size ? scripts : null;
  } catch {
    return null;
  }
}
