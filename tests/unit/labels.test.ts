import { describe, expect, it } from "vitest";
import { concatTransformationMatrix, drawObject, PDFDocument, PDFName, popGraphicsState, pushGraphicsState, StandardFonts } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildLabelPdf, DEFAULT_LABEL_OPTIONS, findLabels, type LabelOptions } from "../../src/labels/labels";

const A4: [number, number] = [595, 842];

/** Shopee-style A4: label text (and a 1-px-high barcode) in the chosen halves. */
async function shopeePdf(halvesPerPage: ("top" | "bottom")[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // 60 x 1 grey image: bars every other module.
  const bars = new Uint8Array(60).map((_, i) => (i % 3 === 0 ? 0 : 255));
  const img = doc.context.register(
    doc.context.flateStream(bars, { Type: "XObject", Subtype: "Image", Width: 60, Height: 1, ColorSpace: "DeviceGray", BitsPerComponent: 8 }),
  );
  for (const halves of halvesPerPage) {
    const page = doc.addPage(A4);
    page.node.setXObject(PDFName.of("Bc"), img);
    page.drawText("- - - - - - - - - - - - - - - - - -", { x: 40, y: A4[1] / 2, size: 10, font }); // cut line only
    for (const half of halves) {
      const y = half === "top" ? 600 : 180;
      page.drawText("SPX Express  TH2410000001", { x: 40, y: y + 120, size: 14, font });
      page.drawText("Shopee Order No. 241014ABCDEF", { x: 40, y, size: 12, font });
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(300, 0, 0, 30, 40, y + 40), drawObject("Bc"), popGraphicsState());
    }
  }
  return doc.save();
}

async function labels(bytes: Uint8Array, o: Partial<LabelOptions>) {
  const task = getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const out = await buildLabelPdf(bytes, await task.promise, { ...DEFAULT_LABEL_OPTIONS, ...o }, OPS);
  await task.destroy();
  const doc = await PDFDocument.load(out.bytes);
  return { count: out.count, sizes: doc.getPages().map((p) => p.getSize()) };
}

const mm = (v: number) => Math.round((v * 25.4) / 72 * 10) / 10;

describe("label printing mode", () => {
  it("Shopee: one label per half page, empty halves skipped, on 82.6 x 49.8 mm stock", async () => {
    const src = await shopeePdf([["top"], ["top", "bottom"]]);
    const { count, sizes } = await labels(src, { preset: "shopee" });
    expect(count).toBe(3);
    for (const s of sizes) expect([mm(s.width), mm(s.height)]).toEqual([82.6, 49.8]);
  });

  it("reads each label's barcode pattern exactly (for sharp printing), also when pages share the image", async () => {
    const src = await shopeePdf([["top"], ["top", "bottom"]]);
    const task = getDocument({ data: src.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
    const pieces = await findLabels(await task.promise, { ...DEFAULT_LABEL_OPTIONS, preset: "shopee" }, OPS);
    await task.destroy();
    expect(pieces).toHaveLength(3);
    const expected = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? "1" : "0")).join("");
    for (const p of pieces) expect(p.barcodes.map((b) => b.modules)).toEqual([expected]);
    expect(pieces[0].text.some((t) => t.str.startsWith("Shopee Order No."))).toBe(true);
  });

  it("works with crisp barcodes and the big order number turned off too", async () => {
    const src = await shopeePdf([["bottom"]]);
    const { count } = await labels(src, { preset: "shopee", crispBarcodes: false, bigOrderNumber: false });
    expect(count).toBe(1);
  });

  it("Lazada: the top-left piece of every page", async () => {
    const src = await shopeePdf([["top"], ["top"]]);
    const { count, sizes } = await labels(src, { preset: "lazada", stockMm: { width: 100, height: 150 } });
    expect(count).toBe(2);
    expect([mm(sizes[0].width), mm(sizes[0].height)]).toEqual([100, 150]);
  });

  it("grid: only cells with something on them", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage(A4);
    p.drawText("Label A", { x: 60, y: 700, size: 14, font }); // top-left
    p.drawText("Label B", { x: 360, y: 700, size: 14, font }); // top-right
    p.drawText("Label C", { x: 60, y: 200, size: 14, font }); // bottom-left
    const { count } = await labels(await doc.save(), { preset: "grid", rows: 2, cols: 2 });
    expect(count).toBe(3);
  });

  it("whole page: every page is a label", async () => {
    const src = await shopeePdf([[], ["top"]]);
    expect((await labels(src, { preset: "page" })).count).toBe(2);
  });
});
