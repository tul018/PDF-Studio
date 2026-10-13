// Generates test PDFs into tests/fixtures/ (not committed):
//   basic.pdf        12 pages, mixed sizes/rotation, link, searchable text
//   form.pdf         AcroForm with text field, checkbox, dropdown
//   heavy-images.pdf 400 pages, each with a 3200x2400 RGB image (~23 MB decoded
//                    per page) - the kind of file that crashes naive viewers.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from "pdf-lib";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(out, { recursive: true });
const force = process.argv.includes("--force");

async function basic() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i++) {
    const landscape = i === 5;
    const page = doc.addPage(landscape ? [792, 612] : [612, 792]);
    if (i === 7) page.setRotation(degrees(90));
    page.drawText(`Page ${i}`, { x: 72, y: page.getHeight() - 100, size: 36, font });
    page.drawText(`The quick brown fox jumps over the lazy dog. Marker-${i}`, { x: 72, y: page.getHeight() - 160, size: 14, font });
    if (i === 3) page.drawText("needle in a haystack", { x: 72, y: 300, size: 14, font, color: rgb(0.2, 0.2, 0.6) });
    if (i === 10) page.drawText("needle again", { x: 72, y: 200, size: 14, font });
  }
  writeFileSync(join(out, "basic.pdf"), await doc.save());
}

async function form() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Application form", { x: 72, y: 720, size: 24, font });
  const f = doc.getForm();
  page.drawText("Name:", { x: 72, y: 660, size: 12, font });
  f.createTextField("name").addToPage(page, { x: 150, y: 650, width: 250, height: 22 });
  page.drawText("Subscribe:", { x: 72, y: 610, size: 12, font });
  f.createCheckBox("subscribe").addToPage(page, { x: 150, y: 605, width: 16, height: 16 });
  page.drawText("Country:", { x: 72, y: 560, size: 12, font });
  const dd = f.createDropdown("country");
  dd.addOptions(["Thailand", "Japan", "USA"]);
  dd.addToPage(page, { x: 150, y: 552, width: 150, height: 22 });
  writeFileSync(join(out, "form.pdf"), await doc.save());
}

function makeImage(doc, w, h, seed) {
  const px = Buffer.alloc(w * h * 3);
  let s = seed * 9973 + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = (s >> 16) & 31;
      const o = (y * w + x) * 3;
      px[o] = ((x * 255) / w + seed * 40 + n) & 255;
      px[o + 1] = ((y * 255) / h + n) & 255;
      px[o + 2] = (((x + y) * 128) / (w + h) + seed * 15) & 255;
    }
  }
  const stream = doc.context.stream(deflateSync(px, { level: 1 }), {
    Type: "XObject",
    Subtype: "Image",
    Width: w,
    Height: h,
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
    Filter: "FlateDecode",
  });
  return doc.context.register(stream);
}

async function heavy() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const W = 3200, H = 2400, N = 400, DISTINCT = 16;
  const imgs = [];
  for (let k = 0; k < DISTINCT; k++) imgs.push(makeImage(doc, W, H, k));
  for (let i = 1; i <= N; i++) {
    const page = doc.addPage([612, 792]);
    const name = `Im${i}`;
    page.node.setXObject(PDFName.of(name), imgs[i % DISTINCT]);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(540, 0, 0, 405, 36, 300), drawObject(name), popGraphicsState());
    page.drawText(`Photo page ${i}`, { x: 36, y: 740, size: 28, font });
  }
  writeFileSync(join(out, "heavy-images.pdf"), await doc.save({ useObjectStreams: true }));
}

for (const [name, fn] of [["basic.pdf", basic], ["form.pdf", form], ["heavy-images.pdf", heavy]]) {
  if (!force && existsSync(join(out, name))) continue;
  const t = Date.now();
  await fn();
  console.log(`${name} written in ${Date.now() - t} ms`);
}
