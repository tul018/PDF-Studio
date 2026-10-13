import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyEdits, type SavePlan } from "../../src/save/applyEdits";
import type { Annotation } from "../../src/edit/model";

async function makePdf(n: number, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Source page ${i + 1}`, { x: 50, y: 700, size: 20, font });
    if (rotate) p.setRotation(degrees(rotate));
  }
  return doc.save();
}

async function text(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    pages.push({ rotate: p.rotate, items: tc.items as Array<{ str: string; transform: number[] }> });
  }
  await task.destroy();
  return pages;
}

const plan = (src: Uint8Array, pages: SavePlan["pages"]): SavePlan => ({
  sources: { d: src },
  pages,
  formValues: {},
  images: {},
  textImages: {},
});

describe("applyEdits", () => {
  it("edits in place when the page order is unchanged", async () => {
    const src = await makePdf(3);
    const note: Annotation = { id: "n", pageId: "p0", type: "note", x: 100, y: 100, text: "Check this", color: "#ffd54f" };
    const txt: Annotation = {
      id: "t",
      pageId: "p0",
      type: "text",
      box: { x: 50, y: 400, w: 200, h: 24, rot: 0 },
      text: "Hello world",
      fontSize: 14,
      color: "#000000",
    };
    const out = await applyEdits(
      plan(src, [0, 1, 2].map((i) => ({ docId: "d", srcIndex: i, rotation: i === 1 ? 90 : 0, annotations: i === 0 ? [note, txt] : [] }))),
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    const pages = await text(out);
    expect(pages[0].items.map((i) => i.str).join(" ")).toContain("Hello world");
  });

  it("reorders, duplicates and inserts blank pages", async () => {
    const src = await makePdf(3);
    const out = await applyEdits(
      plan(src, [
        { docId: "d", srcIndex: 2, rotation: 0, annotations: [] },
        { docId: null, srcIndex: 0, rotation: 0, blank: { width: 300, height: 400 }, annotations: [] },
        { docId: "d", srcIndex: 0, rotation: 0, annotations: [] },
        { docId: "d", srcIndex: 0, rotation: 0, annotations: [] },
      ]),
    );
    const pages = await text(out);
    expect(pages.map((p) => p.items.map((i) => i.str).join(""))).toEqual([
      "Source page 3",
      "",
      "Source page 1",
      "Source page 1",
    ]);
  });

  it("keeps text upright on rotated pages (drawn with the page's rotation)", async () => {
    const src = await makePdf(1, 90);
    const a: Annotation = {
      id: "t",
      pageId: "p",
      type: "text",
      box: { x: 300, y: 300, w: 100, h: 20, rot: 90 },
      text: "Upright",
      fontSize: 12,
      color: "#000000",
    };
    const out = await applyEdits(plan(src, [{ docId: "d", srcIndex: 0, rotation: 0, annotations: [a] }]));
    const [page] = await text(out);
    const item = page.items.find((i) => i.str === "Upright")!;
    // Rotated 90 deg counter-clockwise in user space => [0, s, -s, 0]
    expect(item.transform[0]).toBeCloseTo(0);
    expect(item.transform[1]).toBeGreaterThan(0);
    expect(item.transform[2]).toBeLessThan(0);
  });

  it("merges pages from two documents", async () => {
    const a = await makePdf(2);
    const b = await makePdf(1);
    const out = await applyEdits({
      sources: { a, b },
      pages: [
        { docId: "a", srcIndex: 0, rotation: 0, annotations: [] },
        { docId: "b", srcIndex: 0, rotation: 0, annotations: [] },
        { docId: "a", srcIndex: 1, rotation: 0, annotations: [] },
      ],
      formValues: {},
      images: {},
      textImages: {},
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });
});
