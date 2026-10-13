import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { splitParts, splitPdf } from "../../src/save/split";

async function numbered(n: number, linkFrom1To?: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle("Catalog");
  const pages = Array.from({ length: n }, (_, i) => {
    const p = doc.addPage([300, 300]);
    p.drawText(`Part page ${i + 1} SECRET${i + 1}`, { x: 20, y: 150, size: 12, font });
    return p;
  });
  if (linkFrom1To !== undefined) {
    const ctx = doc.context;
    const link = ctx.register(
      ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], Dest: [pages[linkFrom1To].ref, PDFName.of("Fit")] }),
    );
    pages[0].node.set(PDFName.of("Annots"), ctx.obj([link]));
  }
  return doc.save();
}

async function texts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const pdf = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    out.push(((await (await pdf.getPage(i)).getTextContent()).items as { str: string }[]).map((t) => t.str).join(" "));
  }
  await task.destroy();
  return out;
}

describe("split", () => {
  it("parts: every N pages, ranges as typed, one per page", () => {
    expect(splitParts(7, { every: 3 })).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(splitParts(3, { every: 1 })).toEqual([[0], [1], [2]]);
    expect(splitParts(12, { ranges: "1-3, 5 9-" })).toEqual([[0, 1, 2], [4], [8, 9, 10, 11]]);
    expect(splitParts(12, { ranges: "-2" })).toEqual([[0, 1]]);
    expect(() => splitParts(5, { ranges: "4-9" })).toThrow("outside pages 1-5");
    expect(() => splitParts(5, { ranges: "abc" })).toThrow("not a page range");
    expect(() => splitParts(5, { ranges: " " })).toThrow("Type the page ranges");
  });

  it("each part has only its pages; metadata kept; links into other parts dropped without dragging pages along", async () => {
    const src = await numbered(5, 4); // page 1 links to page 5
    const parts = await splitPdf(src, splitParts(5, { ranges: "1-2, 3-5" }));
    expect(parts).toHaveLength(2);
    expect(await texts(parts[0])).toEqual(["Part page 1 SECRET1", "Part page 2 SECRET2"]);
    expect(await texts(parts[1])).toEqual(["Part page 3 SECRET3", "Part page 4 SECRET4", "Part page 5 SECRET5"]);
    const first = await PDFDocument.load(parts[0]);
    expect(first.getTitle()).toBe("Catalog");
    // The link's target (page 5) is in the other part: the link stays but goes nowhere,
    // and page 5's content is not hidden inside part 1.
    let pageObjects = 0;
    for (const [, o] of first.context.enumerateIndirectObjects()) {
      if (o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Page")) pageObjects++;
    }
    expect(pageObjects).toBe(2);
  });

  it("a link within the same part keeps working", async () => {
    const src = await numbered(4, 1); // page 1 -> page 2
    const [part] = await splitPdf(src, [[0, 1]]);
    const task = getDocument({ data: part.slice() });
    const pdf = await task.promise;
    const [l] = (await (await pdf.getPage(1)).getAnnotations()).filter((a) => a.subtype === "Link");
    expect(await pdf.getPageIndex(l.dest[0])).toBe(1);
    await task.destroy();
  });
});
