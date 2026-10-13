import { describe, expect, it } from "vitest";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFRawStream, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyEdits, type PlanPage, type SavePlan } from "../../src/save/applyEdits";

/**
 * Saves that rebuild the document (delete / reorder / insert / merge /
 * redact) must keep bookmarks, metadata, attachments and internal links,
 * and must never drag a redacted page's original content into the file.
 */

const SECRET = "TOPSECRET42";

/** 3 pages; page 1 links to page 3; outline -> pages 1..3; named dest "chap3". */
async function makeStructuredPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle("Structured title");
  doc.setAuthor("Tester");
  const pages = [0, 1, 2].map((i) => {
    const p = doc.addPage([612, 792]);
    p.drawText(i === 2 ? `Page 3 ${SECRET}` : `Page ${i + 1}`, { x: 50, y: 700, size: 20, font });
    return p;
  });
  const ctx = doc.context;
  const dest = (i: number) => ctx.obj([pages[i].ref, PDFName.of("XYZ"), 0, 792, PDFNull]);

  // Link annotation on page 1 -> page 3 (explicit dest) and -> "chap3" (named dest).
  const link = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [50, 600, 200, 620], Border: [0, 0, 0], Dest: dest(2), P: pages[0].ref }),
  );
  const named = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [50, 560, 200, 580],
      Border: [0, 0, 0],
      A: { S: "GoTo", D: PDFHexString.fromText("chap3") },
    }),
  );
  pages[0].node.set(PDFName.of("Annots"), ctx.obj([link, named]));

  // Outline: Chapter 1, Chapter 2 (with a child), Chapter 3.
  const outlines = ctx.nextRef();
  const items = [0, 1, 2].map(() => ctx.nextRef());
  const child = ctx.nextRef();
  items.forEach((ref, i) => {
    const d: Record<string, unknown> = { Title: PDFHexString.fromText(`Chapter ${i + 1}`), Parent: outlines, Dest: dest(i) };
    if (i > 0) d.Prev = items[i - 1];
    if (i < 2) d.Next = items[i + 1];
    if (i === 1) Object.assign(d, { First: child, Last: child, Count: 1 });
    ctx.assign(ref, ctx.obj(d as never));
  });
  ctx.assign(child, ctx.obj({ Title: PDFHexString.fromText("Section 2.1"), Parent: items[1], Dest: dest(1) }));
  ctx.assign(outlines, ctx.obj({ Type: "Outlines", First: items[0], Last: items[2], Count: 3 }));
  doc.catalog.set(PDFName.of("Outlines"), outlines);

  // Named destination + an attachment.
  doc.catalog.set(
    PDFName.of("Names"),
    ctx.obj({ Dests: ctx.obj({ Names: [PDFHexString.fromText("chap3"), dest(2)] }) }),
  );
  await doc.attach(new TextEncoder().encode("hello"), "notes.txt", { mimeType: "text/plain" });
  return doc.save({ useObjectStreams: false });
}

const plan = (src: Uint8Array, pages: PlanPage[]): SavePlan => ({
  sources: { d: src },
  pages,
  formValues: {},
  images: {},
  textImages: {},
});
const page = (srcIndex: number, extra: Partial<PlanPage> = {}): PlanPage => ({
  docId: "d",
  srcIndex,
  rotation: 0,
  annotations: [],
  ...extra,
});

/** A tiny valid JPEG standing in for the redacted raster. */
async function fakeRaster(): Promise<PlanPage["raster"]> {
  const jpeg = Uint8Array.from(
    atob(
      "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    ),
    (c) => c.charCodeAt(0),
  );
  return { bytes: jpeg, view: [0, 0, 612, 792], rotate: 0 };
}

async function outlineOf(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const walk = async (items: Awaited<ReturnType<typeof doc.getOutline>>): Promise<unknown[]> =>
    Promise.all(
      (items ?? []).map(async (it) => {
        let dest = it.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        const pageNo = Array.isArray(dest) && dest[0] ? (await doc.getPageIndex(dest[0])) + 1 : null;
        return { title: it.title, page: pageNo, items: await walk(it.items) };
      }),
    );
  const outline = await walk(await doc.getOutline());
  const links = (await (await doc.getPage(1)).getAnnotations()).filter((a) => a.subtype === "Link");
  const linkPages = await Promise.all(
    links.map(async (l) => {
      let dest = l.dest;
      if (typeof dest === "string") dest = await doc.getDestination(dest);
      return Array.isArray(dest) && dest[0] ? (await doc.getPageIndex(dest[0])) + 1 : null;
    }),
  );
  await task.destroy();
  const attachments = await attachmentNames(bytes);
  return { outline, linkPages, attachments };
}

describe("structural saves", () => {
  it("keeps bookmarks, metadata, attachments and links when pages are reordered", async () => {
    const src = await makeStructuredPdf();
    const out = await applyEdits(plan(src, [page(2), page(0), page(1)]));
    const doc = await PDFDocument.load(out);
    expect(doc.getTitle()).toBe("Structured title");
    expect(doc.getAuthor()).toBe("Tester");
    const { outline, linkPages, attachments } = await outlineOf(out);
    expect(outline).toEqual([
      { title: "Chapter 1", page: 2, items: [] },
      { title: "Chapter 2", page: 3, items: [{ title: "Section 2.1", page: 3, items: [] }] },
      { title: "Chapter 3", page: 1, items: [] },
    ]);
    // Original page 1 is now page 2; both its links point at old page 3 = new page 1.
    const d2 = await PDFDocument.load(out);
    expect(d2.getPageCount()).toBe(3);
    expect(attachments).toEqual(["notes.txt:5"]);
    const task = getDocument({ data: out.slice() });
    const pdf = await task.promise;
    const links = (await (await pdf.getPage(2)).getAnnotations()).filter((a) => a.subtype === "Link");
    const targets = await Promise.all(
      links.map(async (l) => {
        const dest = typeof l.dest === "string" ? await pdf.getDestination(l.dest) : l.dest;
        return (await pdf.getPageIndex(dest[0])) + 1;
      }),
    );
    await task.destroy();
    expect(targets).toEqual([1, 1]);
    void linkPages;
  });

  it("drops bookmarks and links to deleted pages", async () => {
    const src = await makeStructuredPdf();
    const out = await applyEdits(plan(src, [page(0), page(1)]));
    const { outline, linkPages } = await outlineOf(out);
    expect(outline).toEqual([
      { title: "Chapter 1", page: 1, items: [] },
      { title: "Chapter 2", page: 2, items: [{ title: "Section 2.1", page: 2, items: [] }] },
    ]);
    expect(linkPages.every((p) => p === null)).toBe(true);
    // The deleted page must not be carried along through the link.
    const d = await PDFDocument.load(out);
    for (const [, obj] of d.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) expect(decoded(obj)).not.toMatch(SECRET_RE);
    }
    expect(await countPageObjects(out)).toBe(2);
  });

  it("never leaks a redacted page's original content through a link to it", async () => {
    const src = await makeStructuredPdf();
    const out = await applyEdits(plan(src, [page(0), page(1), page(2, { raster: await fakeRaster() })]));
    expect(await countPageObjects(out)).toBe(3);
    const pdf = await getDocument({ data: out.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" })
      .promise;
    const all: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      all.push(...((await (await pdf.getPage(i)).getTextContent()).items as { str: string }[]).map((t) => t.str));
    }
    expect(all.join(" ")).not.toContain(SECRET);
    // The text is drawn with a Helvetica content stream; make sure that stream isn't in the file at all.
    const doc = await PDFDocument.load(out);
    let leaked = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && SECRET_RE.test(decoded(obj))) leaked = true;
    }
    expect(leaked).toBe(false);
    // ...and the link still works: it now points at the redacted image page.
    const { linkPages } = await outlineOf(out);
    expect(linkPages).toEqual([3, 3]);
  });
});

const SECRET_RE = new RegExp(`${SECRET}|${[...SECRET].map((c) => c.charCodeAt(0).toString(16)).join("")}`, "i");

function decoded(stream: PDFRawStream): string {
  try {
    return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
  } catch {
    return "";
  }
}

/** Attachment names and sizes, read with pdf-lib (PDF.js 6 doesn't list them for these files). */
async function attachmentNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const names = doc.catalog
    .lookupMaybe(PDFName.of("Names"), PDFDict)
    ?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict)
    ?.lookupMaybe(PDFName.of("Names"), PDFArray);
  const out: string[] = [];
  for (let i = 0; names && i + 1 < names.size(); i += 2) {
    const spec = names.lookup(i + 1, PDFDict);
    const file = spec.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F")) as PDFRawStream;
    out.push(`${(names.lookup(i) as PDFHexString).decodeText()}:${decodePDFRawStream(file).decode().length}`);
  }
  return out;
}

/** Page dictionaries anywhere in the file (reachable from the tree or not). */
async function countPageObjects(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Page")) n++;
  }
  return n;
}
