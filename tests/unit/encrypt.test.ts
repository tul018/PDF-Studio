import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { saveEncrypted } from "../../src/save/encrypt";

async function sample(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle("Secret report");
  doc.addPage([300, 300]).drawText("Top secret HD-2201", { x: 20, y: 150, size: 14, font });
  doc.addPage([300, 300]).drawText("Second page", { x: 20, y: 150, size: 14, font });
  return doc;
}

async function open(bytes: Uint8Array, password?: string) {
  const task = getDocument({ data: bytes.slice(), password, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  try {
    const pdf = await task.promise;
    const text = ((await (await pdf.getPage(1)).getTextContent()).items as { str: string }[]).map((t) => t.str).join(" ");
    const title = ((await pdf.getMetadata()).info as { Title?: string }).Title;
    return { pages: pdf.numPages, text, title };
  } finally {
    await task.destroy();
  }
}

describe("password protection (AES-256)", () => {
  it("opens only with the password; text and metadata intact; nothing readable in the file", async () => {
    const bytes = await saveEncrypted(await sample(), { userPassword: "รหัส1234" });
    await expect(open(bytes)).rejects.toMatchObject({ name: "PasswordException" });
    await expect(open(bytes, "wrong")).rejects.toMatchObject({ name: "PasswordException" });
    expect(await open(bytes, "รหัส1234")).toEqual({ pages: 2, text: "Top secret HD-2201", title: "Secret report" });
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toContain("/AESV3");
    expect(raw).not.toContain("Secret report");
  }, 30_000);

  it("the owner password opens it too", async () => {
    const bytes = await saveEncrypted(await sample(), { userPassword: "open", ownerPassword: "boss" });
    expect((await open(bytes, "boss")).pages).toBe(2);
  }, 30_000);

  it("every protected file opens: 60 files, random keys, both passwords", async () => {
    // The key hash ends on a random byte; it used to stop one round early in ~4% of files.
    let failed = 0;
    for (let i = 0; i < 60; i++) {
      const doc = await PDFDocument.create();
      doc.addPage([100, 100]);
      const bytes = await saveEncrypted(doc, { userPassword: "open", ownerPassword: "boss" });
      for (const pw of ["open", "boss"]) {
        const task = getDocument({ data: bytes.slice(), password: pw });
        await task.promise.catch(() => failed++);
        await task.destroy();
      }
    }
    expect(failed).toBe(0);
  }, 120_000);
});
