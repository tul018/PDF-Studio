import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, StandardFonts, type PDFObject } from "pdf-lib";
import { applyEdits, type SavePlan } from "../../src/save/applyEdits";
import { decryptPdf, md5, rc4 } from "../../src/save/decrypt";
import { saveEncrypted } from "../../src/save/encrypt";

const PAD = [
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
];
const cat = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of p) (out.set(x, o), (o += x.length));
  return out;
};
const hex = (b: Uint8Array) => PDFHexString.of(Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));

async function formDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText("Application for Outward Remittance", { x: 20, y: 260, size: 12, font });
  const form = doc.getForm();
  const name = form.createTextField("name");
  name.setText("THAI-RADITECH CO.,LTD");
  name.addToPage(page, { x: 20, y: 200, width: 200, height: 20 });
  // One field, two boxes with their own on-values (like "Individual" / "Juristic person").
  const kind = form.createCheckBox("kind");
  kind.addToPage(page, { x: 20, y: 150, width: 12, height: 12 });
  kind.addToPage(page, { x: 120, y: 150, width: 12, height: 12 });
  const [, second] = kind.acroField.getWidgets();
  for (const k of ["N", "D"]) {
    const states = second.dict.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of(k), PDFDict);
    states.set(PDFName.of("1"), states.get(PDFName.of("Yes"))!);
    states.delete(PDFName.of("Yes"));
  }
  return doc;
}

/** Permissions-only protection the way many bank forms have it: RC4-128 (R3), empty open password. */
async function rc4Protected(doc: PDFDocument): Promise<Uint8Array> {
  await doc.flush();
  const ctx = doc.context;
  const id0 = new Uint8Array(16).map((_, i) => i * 7);
  const p = -1084;
  const ownerKey = (() => {
    let h = md5(new Uint8Array(enc("owner-secret").concat(PAD).slice(0, 32)));
    for (let i = 0; i < 50; i++) h = md5(h);
    return h;
  })();
  let o = rc4(ownerKey, new Uint8Array(PAD));
  for (let i = 1; i <= 19; i++) o = rc4(ownerKey.map((b) => b ^ i), o);
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p, true);
  let key = md5(cat(new Uint8Array(PAD), o, pBytes, id0));
  for (let i = 0; i < 50; i++) key = md5(key);
  let u = rc4(key, md5(cat(new Uint8Array(PAD), id0)));
  for (let i = 1; i <= 19; i++) u = rc4(key.map((b) => b ^ i), u);

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const n = ref.objectNumber;
    const objKey = md5(cat(key, new Uint8Array([n & 255, (n >> 8) & 255, n >> 16, 0, 0]))).subarray(0, 16);
    const deep = (x: PDFObject): PDFObject => {
      if (x instanceof PDFString || x instanceof PDFHexString) return hex(rc4(objKey, x.asBytes()));
      if (x instanceof PDFDict) for (const [k, v] of x.entries()) x.set(k, deep(v));
      return x;
    };
    if (obj instanceof PDFRawStream) ctx.assign(ref, PDFRawStream.of(deep(obj.dict) as PDFDict, rc4(objKey, obj.contents)));
    else ctx.assign(ref, deep(obj));
  }
  const dict = ctx.obj({ Filter: "Standard", V: 2, R: 3, Length: 128, P: PDFNumber.of(p) }) as PDFDict;
  dict.set(PDFName.of("O"), hex(o));
  dict.set(PDFName.of("U"), hex(cat(u, new Uint8Array(16))));
  ctx.trailerInfo.Encrypt = ctx.register(dict);
  ctx.trailerInfo.ID = ctx.obj([hex(id0), hex(id0)]);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
function enc(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

const plan = (src: Uint8Array, formValues: SavePlan["formValues"] = {}): SavePlan => ({
  sources: { d: src },
  pages: [{ docId: "d", srcIndex: 0, rotation: 0, annotations: [] }],
  formValues,
  images: {},
  textImages: {},
});

describe("decrypting protected PDFs for saving", () => {
  it("md5 matches the reference vectors", () => {
    const h = (s: string) => Array.from(md5(new TextEncoder().encode(s)), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(h("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(h("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
  });

  it("RC4 permissions-only form: saves as a normal, still-fillable PDF", async () => {
    const bytes = await rc4Protected(await formDoc());
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/);
    const out = await applyEdits(plan(bytes, { d: { name: "GUANGDONG AKV", kind: "1" } }));
    const doc = await PDFDocument.load(out);
    expect(doc.context.trailerInfo.Encrypt).toBeUndefined();
    const form = doc.getForm();
    expect(form.getTextField("name").getText()).toBe("GUANGDONG AKV");
    // Only the box whose on-value was chosen is ticked.
    const widgets = form.getCheckBox("kind").acroField.getWidgets();
    expect(widgets.map((w) => w.getAppearanceState()?.asString())).toEqual(["/Off", "/1"]);
  }, 30_000);

  it("AES-256 file opened with its password", async () => {
    const bytes = await saveEncrypted(await formDoc(), { userPassword: "pw2026" });
    const doc = await PDFDocument.load(await decryptPdf(bytes, "pw2026"));
    expect(doc.getForm().getTextField("name").getText()).toBe("THAI-RADITECH CO.,LTD");
    await expect(decryptPdf(bytes, "wrong")).rejects.toMatchObject({ name: "UnsupportedEncryptionError" });
  }, 30_000);
});
