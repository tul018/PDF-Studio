import { objectSnapshot, saveIncremental } from "../professional/incremental";
import { nativeAnnotation } from "../professional/nativeAnnotations";
import {
  BlendMode,
  degrees,
  LineCapStyle,
  PDFBool,
  PDFCheckBox,
  PDFContentStream,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { rotVec, textLines, type Annotation, type Box, type FormValue } from "../edit/model";
import { saveEncrypted, type Protection } from "./encrypt";
import { copyDocumentStructure, detachPageLinks, pruneUnreachable, relinkPage, type PageTarget } from "./structure";

/**
 * Pure "apply the edit model to the source bytes" step. Runs inside a Web
 * Worker in the app (UI stays at 60 fps while a 500-page file is rebuilt)
 * and directly in Node for unit tests.
 */
export interface PlanPage {
  docId: string | null;
  srcIndex: number;
  /** User-added rotation. */
  rotation: number;
  blank?: { width: number; height: number };
  /** Show only this part of the page [x0, y0, x1, y1] ("Cut pages"): becomes its MediaBox/CropBox. */
  crop?: number[];
  /** Rasterized replacement (true redaction / encrypted source). */
  raster?: { bytes: Uint8Array; view: number[]; rotate: number };
  annotations: Annotation[];
}

export interface SavePlan {
  nativeAnnotations?: boolean;
  incremental?: boolean;
  sources: Record<string, Uint8Array>;
  pages: PlanPage[];
  /** docId -> fieldName -> value */
  formValues: Record<string, Record<string, FormValue>>;
  images: Record<string, { bytes: Uint8Array; mime: string }>;
  /** Annotation id -> pre-rendered PNG for text the standard font can't encode (Thai, CJK, emoji...). */
  textImages: Record<string, Uint8Array>;
  /** Save with a password (AES-256). */
  protect?: Protection;
}

export type Progress = (done: number, total: number) => void;

export async function applyEdits(plan: SavePlan, onProgress: Progress = () => {}): Promise<Uint8Array> {
  const usedDocIds = [...new Set(plan.pages.filter((p) => !p.raster).map((p) => p.docId).filter((d): d is string => !!d))];
  const src = new Map<string, PDFDocument>();
  for (const id of usedDocIds) {
    src.set(id, await PDFDocument.load(plan.sources[id], { updateMetadata: false }));
  }

  const only = usedDocIds.length === 1 ? src.get(usedDocIds[0])! : null;
  const identity =
    !!only &&
    plan.pages.length === only.getPageCount() &&
    plan.pages.every((p, i) => p.docId === usedDocIds[0] && p.srcIndex === i && !p.raster && !p.blank && !p.crop);

  const snapshot = plan.incremental && identity && !plan.protect ? objectSnapshot(only!, plan.sources[usedDocIds[0]]) : undefined;
  let needAppearanceFallback = false;
  for (const [id, doc] of src) {
    const values = plan.formValues[id];
    if (values && fillForm(doc, values)) needAppearanceFallback = true;
  }

  let out: PDFDocument;
  if (identity) {
    // Edit in place: keeps bookmarks, metadata, attachments, live form fields.
    out = only!;
  } else {
    // Structural change: flatten filled forms first (pdf-lib's copyPages
    // doesn't carry the AcroForm across documents), then assemble.
    for (const [id, doc] of src) {
      if (plan.formValues[id] && Object.keys(plan.formValues[id]).length) {
        try {
          doc.getForm().flatten();
        } catch (e) {
          console.warn("form flatten failed; fields kept as-is", e);
        }
      }
    }
    // Links between pages would otherwise pull deleted/redacted pages along.
    for (const [id, doc] of src) {
      detachPageLinks(doc, new Set(plan.pages.filter((p) => p.docId === id && !p.raster).map((p) => p.srcIndex)));
    }
    out = await PDFDocument.create({ updateMetadata: false });
    const copies = new Map<string, Map<number, PDFPage>>();
    for (const id of usedDocIds) {
      const indices = [...new Set(plan.pages.filter((p) => p.docId === id && !p.raster).map((p) => p.srcIndex))];
      const copied = await out.copyPages(src.get(id)!, indices);
      copies.set(id, new Map(indices.map((ix, k) => [ix, copied[k]])));
    }
    const used = new Set<PDFPage>();
    for (const p of plan.pages) {
      if (p.raster) {
        const [x0, y0, x1, y1] = p.raster.view;
        const page = out.addPage([x1 - x0, y1 - y0]);
        page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
        const img = await out.embedJpg(p.raster.bytes);
        page.drawImage(img, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
        page.setRotation(degrees(p.raster.rotate));
      } else if (p.blank || !p.docId) {
        out.addPage([p.blank?.width ?? 612, p.blank?.height ?? 792]);
      } else {
        let page = copies.get(p.docId)!.get(p.srcIndex)!;
        if (used.has(page)) {
          // Same source page used twice (duplicate): copy again.
          [page] = await out.copyPages(src.get(p.docId)!, [p.srcIndex]);
        }
        used.add(page);
        out.addPage(page);
      }
    }

    const where = new Map<string, PDFRef>();
    plan.pages.forEach((p, i) => {
      const key = `${p.docId}|${p.srcIndex}`;
      if (p.docId && !where.has(key)) where.set(key, out.getPage(i).ref);
    });
    const target: PageTarget = (docId, srcIndex) => where.get(`${docId}|${srcIndex}`);
    plan.pages.forEach((p, i) => {
      if (p.docId && !p.raster) relinkPage(out, out.getPage(i).ref, p.docId, target);
    });
    copyDocumentStructure(out, [...src], target);
  }

  const fonts = new FontCache(out);
  const images = new Map<string, PDFImage>();
  const total = plan.pages.length;
  for (let i = 0; i < total; i++) {
    const p = plan.pages[i];
    const page = out.getPage(i);
    if (p.crop) {
      const [x0, y0, x1, y1] = p.crop;
      page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
      page.setCropBox(x0, y0, x1 - x0, y1 - y0);
      for (const k of ["TrimBox", "BleedBox", "ArtBox"]) page.node.delete(PDFName.of(k));
    }
    if (p.rotation) page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360));
    if (p.annotations.length) {
      if (p.docId && !p.raster) isolateExistingContent(out, page);
      for (const a of p.annotations) {
        if (plan.nativeAnnotations && await nativeAnnotation(out, page, a, temp => drawAnnotation(out, temp, a, plan, fonts, images))) continue;
        await drawAnnotation(out, page, a, plan, fonts, images);
      }
    }
    if (i % 25 === 0) onProgress(i, total);
  }
  onProgress(total, total);
  if (!identity) pruneUnreachable(out);

  if (plan.protect) {
    // Field appearances must exist before encrypting (pdf-lib makes them on save).
    if (out.catalog.get(PDFName.of("AcroForm"))) {
      try {
        out.getForm().updateFieldAppearances();
      } catch {
        out.getForm().acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
      }
    }
    return saveEncrypted(out, plan.protect);
  }
  try {
    if (snapshot && !plan.pages.some(p => p.annotations.some(a => a.type === "redact" || a.type === "whiteout"))) {
      if (out.catalog.get(PDFName.of("AcroForm"))) out.getForm().updateFieldAppearances();
      return saveIncremental(plan.sources[usedDocIds[0]], out, snapshot);
    }
    return await out.save({ useObjectStreams: true });
  } catch (e) {
    if (!needAppearanceFallback && !/WinAnsi|encode/i.test(String(e))) throw e;
    // A form value contains characters Helvetica can't encode (e.g. Thai):
    // let the viewing app regenerate appearances instead.
    const form = out.getForm();
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    return out.save({ useObjectStreams: true, updateFieldAppearances: false });
  }
}

/** Returns true if some value may need the NeedAppearances fallback. */
function fillForm(doc: PDFDocument, values: Record<string, FormValue>): boolean {
  let risky = false;
  let form;
  try {
    form = doc.getForm();
  } catch {
    return false;
  }
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    try {
      if (field instanceof PDFTextField) {
        const s = String(value ?? "");
        if (/[^\u0000-ÿ]/.test(s)) risky = true;
        field.setText(s);
      } else if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === "string" && field.getOptions().includes(value)) field.select(value);
      } else if (field instanceof PDFDropdown) {
        const v = Array.isArray(value) ? value[0] : String(value);
        if (v != null) field.select(v);
      } else if (field instanceof PDFOptionList) {
        const arr = Array.isArray(value) ? value : [String(value)];
        field.select(arr);
      }
    } catch (e) {
      console.warn(`could not set field ${name}`, e);
    }
  }
  return risky;
}

/**
 * Wrap the page's existing content streams in q ... Q so a CTM left changed
 * by the original content can't shift our annotations.
 */
function isolateExistingContent(doc: PDFDocument, page: PDFPage): void {
  const ctx = doc.context;
  page.node.normalize();
  const start = ctx.register(PDFContentStream.of(ctx.obj({}), [pushGraphicsState()]));
  const end = ctx.register(PDFContentStream.of(ctx.obj({}), [popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
}

class FontCache {
  private helv: PDFFont | null = null;
  constructor(private doc: PDFDocument) {}
  async helvetica(): Promise<PDFFont> {
    if (!this.helv) this.helv = await this.doc.embedFont(StandardFonts.Helvetica);
    return this.helv;
  }
}

export function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16) || 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function corner(b: Box, lx: number, ly: number): { x: number; y: number } {
  const [dx, dy] = rotVec(b.rot, lx, ly);
  return { x: b.x + dx, y: b.y + dy };
}

export function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

async function drawAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  a: Annotation,
  plan: SavePlan,
  fonts: FontCache,
  images: Map<string, PDFImage>,
): Promise<void> {
  switch (a.type) {
    case "highlight": {
      const { x, y } = corner(a.box, 0, 0);
      page.drawRectangle({
        x,
        y,
        width: a.box.w,
        height: a.box.h,
        rotate: degrees(a.box.rot),
        color: hexToRgb(a.color),
        opacity: Math.min(1, a.opacity + 0.25),
        blendMode: BlendMode.Multiply,
      });
      return;
    }
    case "whiteout":
    case "redact": {
      const { x, y } = corner(a.box, 0, 0);
      page.drawRectangle({
        x,
        y,
        width: a.box.w,
        height: a.box.h,
        rotate: degrees(a.box.rot),
        color: a.type === "whiteout" ? rgb(1, 1, 1) : rgb(0, 0, 0),
      });
      return;
    }
    case "rect": {
      const sw = a.strokeWidth;
      const { x, y } = corner(a.box, sw / 2, sw / 2);
      page.drawRectangle({
        x,
        y,
        width: Math.max(0, a.box.w - sw),
        height: Math.max(0, a.box.h - sw),
        rotate: degrees(a.box.rot),
        borderColor: hexToRgb(a.color),
        borderWidth: sw,
        borderOpacity: a.opacity,
      });
      return;
    }
    case "ellipse": {
      const sw = a.strokeWidth;
      const { x, y } = corner(a.box, a.box.w / 2, a.box.h / 2);
      page.drawEllipse({
        x,
        y,
        xScale: Math.max(0, a.box.w / 2 - sw / 2),
        yScale: Math.max(0, a.box.h / 2 - sw / 2),
        rotate: degrees(a.box.rot),
        borderColor: hexToRgb(a.color),
        borderWidth: sw,
        borderOpacity: a.opacity,
      });
      return;
    }
    case "ink": {
      if (a.points.length < 2) return;
      // drawSvgPath flips y, so feed it -y.
      let d = `M ${a.points[0]} ${-a.points[1]}`;
      for (let i = 2; i < a.points.length; i += 2) d += ` L ${a.points[i]} ${-a.points[i + 1]}`;
      page.drawSvgPath(d, {
        x: 0,
        y: 0,
        borderColor: hexToRgb(a.color),
        borderWidth: a.width,
        borderOpacity: a.opacity,
        borderLineCap: LineCapStyle.Round,
      });
      return;
    }
    case "line":
    case "arrow": {
      const color = hexToRgb(a.color);
      const line = (x1: number, y1: number, x2: number, y2: number) =>
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: a.width, color, lineCap: LineCapStyle.Round });
      line(a.x1, a.y1, a.x2, a.y2);
      if (a.type === "arrow") {
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        const len = Math.max(8, a.width * 4);
        for (const s of [-Math.PI / 7, Math.PI / 7]) {
          line(a.x2, a.y2, a.x2 - len * Math.cos(ang + s), a.y2 - len * Math.sin(ang + s));
        }
      }
      return;
    }
    case "text": {
      const helv = await fonts.helvetica();
      if (canEncode(helv, a.text)) {
        for (const l of textLines(a)) {
          if (!l.text) continue;
          const { x, y } = corner(a.box, 2, a.box.h - l.baseline - 2);
          page.drawText(l.text, { x, y, size: a.fontSize, font: helv, color: hexToRgb(a.color), rotate: degrees(a.box.rot) });
        }
      } else {
        const png = plan.textImages[a.id];
        if (!png) return;
        const img = await doc.embedPng(png);
        page.drawImage(img, { x: a.box.x, y: a.box.y, width: a.box.w, height: a.box.h, rotate: degrees(a.box.rot) });
      }
      return;
    }
    case "image": {
      let img = images.get(a.imageId);
      if (!img) {
        const src = plan.images[a.imageId];
        if (!src) return;
        img = src.mime === "image/jpeg" ? await doc.embedJpg(src.bytes) : await doc.embedPng(src.bytes);
        images.set(a.imageId, img);
      }
      page.drawImage(img, { x: a.box.x, y: a.box.y, width: a.box.w, height: a.box.h, rotate: degrees(a.box.rot) });
      return;
    }
    case "note": {
      // A real PDF comment (sticky note), editable in Acrobat/Preview/Edge.
      const c = hexToRgb(a.color);
      const ctx = doc.context;
      const annot = ctx.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [a.x, a.y - 20, a.x + 20, a.y],
        Contents: PDFHexString.fromText(a.text),
        Name: "Comment",
        C: [c.red, c.green, c.blue],
        F: 4,
        Open: false,
        M: PDFHexString.fromText(pdfDate(new Date())),
      });
      page.node.addAnnot(ctx.register(annot));
      return;
    }
  }
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
