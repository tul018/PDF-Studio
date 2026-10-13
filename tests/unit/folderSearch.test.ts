import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { BytesSource, type PdfSource } from "../../src/core/source";
import { FolderSearch, findIn, type OpenedPdf } from "../../src/viewer/folderSearch";
import { memoryTextIndex } from "../../src/viewer/textIndex";

async function pdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of pages) {
    const p = doc.addPage([612, 792]);
    if (t) p.drawText(t, { x: 50, y: 700, size: 14, font });
  }
  return doc.save();
}

function deps(opened: string[]) {
  return {
    index: memoryTextIndex(),
    parallel: 2,
    async open(source: PdfSource): Promise<OpenedPdf> {
      opened.push(source.name);
      if (source.name.startsWith("locked")) throw Object.assign(new Error("password"), { name: "PasswordException" });
      const task = getDocument({ data: (await source.readAll()).slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
      return { pdf: await task.promise, close: () => task.destroy() };
    },
  };
}

describe("folder search", () => {
  it("finds a part number across files, reports scans and locked files, and remembers texts", async () => {
    const files = [
      new BytesSource("catalog-a.pdf", await pdf(["Radiator HD-2201 Civic", "Intercooler HD-9900"])),
      new BytesSource("catalog-b.pdf", await pdf(["Nothing here", "Radiator HD-2201 City and HD-2201 Jazz"])),
      new BytesSource("scan.pdf", await pdf(["", ""])),
      new BytesSource("locked.pdf", await pdf(["secret"])),
    ];
    const opened: string[] = [];
    const fs = new FolderSearch(deps(opened));
    const r = await fs.run(files, "hd-2201");
    expect(r.done).toBe(true);
    expect(r.scanned).toBe(4);
    expect(r.results.map((f) => [f.source.name, f.hits.map((h) => [h.pageIndex, h.count])])).toEqual([
      ["catalog-a.pdf", [[0, 1]]],
      ["catalog-b.pdf", [[1, 2]]],
    ]);
    expect(r.results[0].hits[0].match).toBe("HD-2201");
    expect(r.results[0].hits[0].after).toContain("Civic");
    expect(r.noText).toEqual(["scan.pdf"]);
    expect(r.locked).toEqual(["locked.pdf"]);

    // A new query (and a new FolderSearch sharing the index) reads no PDF again.
    opened.length = 0;
    expect((await fs.run(files, "intercooler")).results.map((f) => f.source.name)).toEqual(["catalog-a.pdf"]);
    expect(opened).toEqual(["locked.pdf"]); // only the locked one is retried
  });

  it("a newer search cancels the running one", async () => {
    const files = Array.from({ length: 6 }, async (_, i) => new BytesSource(`f${i}.pdf`, await pdf(["word " + i])));
    const fs = new FolderSearch(deps([]));
    const sources = await Promise.all(files);
    const first = fs.run(sources, "word");
    const second = await fs.run(sources, "word 5");
    expect((await first).done).toBe(false);
    expect(second.results.map((f) => f.source.name)).toEqual(["f5.pdf"]);
  });

  it("snippets: context around the match, Thai and Chinese too", () => {
    const long = "x ".repeat(40) + "start of line with PART-77 in the middle and more text after it";
    const [h] = findIn([long], "part-77");
    expect(h.before.startsWith("…")).toBe(true);
    expect(h.before.endsWith("with ")).toBe(true);
    expect(h.match).toBe("PART-77");
    expect(findIn(["หม้อน้ำรถยนต์ฮอนด้า"], "รถยนต์")[0].before).toBe("หม้อน้ำ");
    expect(findIn(["散热器本田思域"], "本田")[0].after).toBe("思域");
  });
});
