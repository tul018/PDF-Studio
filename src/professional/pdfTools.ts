import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

const N = PDFName.of;
export interface Bookmark { title: string; page: number }
export interface FieldSpec { name: string; page: number; type: "text" | "checkbox"; x: number; y: number; width: number; height: number }
export interface HeaderSpec { header: string; footer: string; prefix: string; start: number; digits: number }

export async function addFields(bytes: Uint8Array, fields: FieldSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  for (const f of fields) {
    if (!f.name.trim() || form.getFieldMaybe(f.name)) throw new Error(`Field name must be unique: ${f.name}`);
    const page = doc.getPage(f.page - 1);
    if (![f.x, f.y, f.width, f.height].every(Number.isFinite) || f.width <= 0 || f.height <= 0 || f.x < 0 || f.y < 0 || f.x + f.width > page.getWidth() || f.y + f.height > page.getHeight()) throw new Error("Field must fit inside its page.");
    const field = f.type === "checkbox" ? form.createCheckBox(f.name) : form.createTextField(f.name);
    field.addToPage(page, { x: f.x, y: f.y, width: f.width, height: f.height, borderWidth: 1, borderColor: rgb(.3,.3,.3) });
  }
  return doc.save();
}

export async function setBookmarks(bytes: Uint8Array, bookmarks: Bookmark[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  if (!bookmarks.length) { doc.catalog.delete(N("Outlines")); return doc.save(); }
  const root = ctx.obj({ Type: "Outlines", Count: bookmarks.length });
  const rootRef = ctx.register(root);
  const items = bookmarks.map(b => {
    if (!Number.isInteger(b.page) || b.page < 1 || b.page > doc.getPageCount() || !b.title.trim()) throw new Error("Every bookmark needs a title and a valid page.");
    return ctx.obj({ Title: PDFHexString.fromText(b.title), Parent: rootRef, Dest: [doc.getPage(b.page - 1).ref, N("Fit")] });
  });
  const refs = items.map(item => ctx.register(item));
  items.forEach((item, i) => { if (i) item.set(N("Prev"), refs[i - 1]); if (i + 1 < refs.length) item.set(N("Next"), refs[i + 1]); });
  root.set(N("First"), refs[0]); root.set(N("Last"), refs[refs.length - 1]);
  doc.catalog.set(N("Outlines"), rootRef);
  return doc.save();
}

export function headerText(template: string, page: number, total: number, spec: HeaderSpec): string {
  return template.replaceAll("{page}", String(page)).replaceAll("{pages}", String(total)).replaceAll("{bates}", spec.prefix + String(spec.start + page - 1).padStart(spec.digits, "0"));
}

export async function addHeaders(bytes: Uint8Array, spec: HeaderSpec): Promise<Uint8Array> {
  if (!Number.isSafeInteger(spec.start) || spec.start < 0 || !Number.isInteger(spec.digits) || spec.digits < 1 || spec.digits > 16) throw new Error("Invalid Bates number settings.");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPages().forEach((page, i) => {
    for (const [template, y] of [[spec.header, page.getHeight() - 24], [spec.footer, 18]] as const) {
      const text = headerText(template, i + 1, doc.getPageCount(), spec);
      if (text) page.drawText(text, { x: 24, y, font, size: 10, maxWidth: page.getWidth() - 48 });
    }
  });
  return doc.save();
}

export interface PdfComment { id: string; page: number; text: string; author: string; resolved: boolean; replyTo?: string }
function decode(value: unknown): string { return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : ""; }
export async function comments(bytes: Uint8Array): Promise<PdfComment[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const result: PdfComment[] = [];
  doc.getPages().forEach((page, i) => {
    const list = page.node.lookupMaybe(N("Annots"), PDFArray);
    list?.asArray().forEach(ref => {
      const a = doc.context.lookup(ref);
      if (!(a instanceof PDFDict) || !a.has(N("Contents")) || a.get(N("Subtype")) === N("Widget")) return;
      result.push({ id: ref.toString(), page: i + 1, text: decode(a.get(N("Contents"))), author: decode(a.get(N("T"))), resolved: decode(a.get(N("State"))) === "Accepted", replyTo: a.get(N("IRT"))?.toString() });
    });
  });
  return result;
}

export async function editComment(bytes: Uint8Array, id: string, change: { resolved?: boolean; reply?: string; text?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const page of doc.getPages()) {
    for (const ref of page.node.lookupMaybe(N("Annots"), PDFArray)?.asArray() ?? []) {
      if (ref.toString() !== id) continue;
      const a = doc.context.lookup(ref, PDFDict);
      if (change.text !== undefined) a.set(N("Contents"), PDFHexString.fromText(change.text));
      if (change.resolved !== undefined) { a.set(N("State"), PDFString.of(change.resolved ? "Accepted" : "None")); a.set(N("StateModel"), PDFString.of("Review")); }
      if (change.reply?.trim()) page.node.addAnnot(doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: a.get(N("Rect")), Contents: PDFHexString.fromText(change.reply), IRT: ref, RT: "R", F: 4, T: PDFHexString.fromText("PDF Studio") })));
      return doc.save();
    }
  }
  throw new Error("Comment no longer exists. Refresh the panel.");
}

export function distance(points: number[][], scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error("Scale must be positive.");
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0) * scale;
}
export function area(points: number[][], scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error("Scale must be positive.");
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0]*q[1] - q[0]*p[1]; }, 0)) / 2 * scale * scale;
}

export function changedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance = 24): { count: number; overlay: Uint8ClampedArray } {
  if (a.length !== b.length) throw new Error("Images must have the same dimensions.");
  const overlay = new Uint8ClampedArray(a.length); let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i]-b[i]), Math.abs(a[i+1]-b[i+1]), Math.abs(a[i+2]-b[i+2])) > tolerance) {
      overlay.set([220, 30, 70, 180], i); count++;
    }
  }
  return { count, overlay };
}
