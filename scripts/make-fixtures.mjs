// Generates test PDFs into tests/fixtures/ (not committed):
//   basic.pdf        12 pages, mixed sizes/rotation, link, searchable text
//   form.pdf         AcroForm with text field, checkbox, dropdown
//   heavy-images.pdf 400 pages, each with a 3200x2400 RGB image (~23 MB decoded
//                    per page) - the kind of file that crashes naive viewers.
//   long-text.pdf    2000 pages of dense text (search / scrolling benchmarks);
//                    "zebra" appears only on the last page.
//   languages.pdf    English, Chinese (standard non-embedded STSong font, as
//                    many Chinese PDFs use) and Thai (embedded system font,
//                    when one is found), with words split into separate text
//                    pieces and across lines - the hard cases for search.
import { crc32, deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFHexString, PDFString, pushGraphicsState, popGraphicsState,
  concatTransformationMatrix, drawObject, beginText, endText, setFontAndSize, moveText, showText,
} from "pdf-lib";

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

async function longText() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s >> 8);
  for (let i = 1; i <= 2000; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Chapter page ${i}`, { x: 54, y: 740, size: 18, font });
    for (let l = 0; l < 52; l++) {
      const line = [];
      for (let w = 0; w < 14; w++) line.push(words[rnd() % words.length]);
      if (i === 2000 && l === 30) line[3] = "zebra";
      page.drawText(line.join(" "), { x: 54, y: 710 - l * 12.5, size: 10, font });
    }
  }
  writeFileSync(join(out, "long-text.pdf"), await doc.save({ useObjectStreams: true }));
}

const THAI_FONTS = [
  "C:/Windows/Fonts/tahoma.ttf",
  "C:/Windows/Fonts/LeelawUI.ttf",
  "/usr/share/fonts/truetype/tlwg/Garuda.ttf",
  "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
  "/usr/share/fonts/opentype/tlwg/Garuda.otf",
];

async function languages() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Languages test: hello world", { x: 54, y: 730, size: 18, font: helv });

  // Chinese with the standard Adobe-GB1 font, not embedded: the viewer must
  // use its bundled CMaps plus a system font.
  const ctx = doc.context;
  const descriptor = ctx.register(ctx.obj({
    Type: "FontDescriptor", FontName: "STSong-Light", Flags: 6, FontBBox: [-25, -254, 1000, 880],
    ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 880, StemV: 93,
  }));
  const cid = ctx.register(ctx.obj({
    Type: "Font", Subtype: "CIDFontType0", BaseFont: "STSong-Light", DW: 1000, FontDescriptor: descriptor,
    CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("GB1"), Supplement: 4 },
  }));
  page.node.setFontDictionary(PDFName.of("FZh"), ctx.register(ctx.obj({
    Type: "Font", Subtype: "Type0", BaseFont: "STSong-Light-UniGB-UCS2-H", Encoding: "UniGB-UCS2-H", DescendantFonts: [cid],
  })));
  const ucs2 = (s) => PDFHexString.of([...s].map((c) => c.codePointAt(0).toString(16).padStart(4, "0")).join(""));
  const zh = (s, x, y) => page.pushOperators(beginText(), setFontAndSize("FZh", 20), moveText(x, y), showText(ucs2(s)), endText());
  zh("你", 54, 680); // "你好" as two separate pieces
  zh("好", 74, 680);
  zh("中文测试世界", 54, 640); // "世界和平" continues on the next line
  zh("和平之城", 54, 615);

  // Thai with an embedded font (Thai has no standard PDF font).
  const thaiPath = THAI_FONTS.find((p) => existsSync(p));
  if (thaiPath) {
    const thai = await doc.embedFont(readFileSync(thaiPath), { subset: true });
    page.drawText("สวัส", { x: 54, y: 560, size: 20, font: thai }); // "สวัสดี" as two pieces
    page.drawText("ดี", { x: 54 + thai.widthOfTextAtSize("สวัส", 20), y: 560, size: 20, font: thai });
    page.drawText("ภาษาไทยอ่านได้", { x: 54, y: 520, size: 20, font: thai });
  } else {
    console.warn("languages.pdf: no Thai font found, Thai part skipped");
  }
  writeFileSync(join(out, "languages.pdf"), await doc.save());
  writeFileSync(join(out, "languages.json"), JSON.stringify({ thai: !!thaiPath }));
}

// Shopee-style shipping labels: A4 pages with one label per half page (3 pages,
// 5 labels: the last page's bottom half is empty), each with a tracking line,
// an order number and a 1-px-high barcode image, plus the dashed cut line.
async function shopeeLabels() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bars = new Uint8Array(96).map((_, i) => ((i * 7) % 5 < 2 ? 0 : 255));
  const img = doc.context.register(
    doc.context.flateStream(bars, { Type: "XObject", Subtype: "Image", Width: 96, Height: 1, ColorSpace: "DeviceGray", BitsPerComponent: 8 }),
  );
  let n = 0;
  for (const halves of [["top", "bottom"], ["top", "bottom"], ["top"]]) {
    const page = doc.addPage([595, 842]);
    page.node.setXObject(PDFName.of("Bc"), img);
    page.drawText("- - - - - - - - - - - - - - - - - - - - - - - - - - - -", { x: 30, y: 421, size: 10, font });
    for (const half of halves) {
      const y = half === "top" ? 470 : 50;
      n++;
      page.drawText(`SPX Express   TH24100000${n}`, { x: 40, y: y + 320, size: 18, font });
      page.drawText(`Buyer ${n}, 99 Sukhumvit Rd, Bangkok 10110`, { x: 40, y: y + 280, size: 12, font });
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(400, 0, 0, 60, 40, y + 160), drawObject("Bc"), popGraphicsState());
      page.drawText(`Shopee Order No. 241014ABC00${n}`, { x: 40, y: y + 120, size: 12, font });
    }
  }
  writeFileSync(join(out, "shopee-labels.pdf"), await doc.save());
}

for (const [name, fn] of [["basic.pdf", basic], ["form.pdf", form], ["heavy-images.pdf", heavy], ["long-text.pdf", longText], ["languages.pdf", languages], ["shopee-labels.pdf", shopeeLabels]]) {
  if (!force && existsSync(join(out, name))) continue;
  const t = Date.now();
  await fn();
  console.log(`${name} written in ${Date.now() - t} ms`);
}

// seal.png: a red ring on white paper, like a scanned company seal (stamp tests).
if (force || !existsSync(join(out, "seal.png"))) {
  const W = 160, H = 160;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - W / 2, y - H / 2);
      const ink = r > 55 && r < 70;
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = ink ? 200 : 250; raw[o + 1] = ink ? 20 : 250; raw[o + 2] = ink ? 30 : 247;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(join(out, "seal.png"), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log("seal.png written");
}

// A folder of PDFs for folder search: basic.pdf, a subfolder with languages.pdf,
// and a scan (an image only, no text).
const catalogs = join(out, "catalogs");
if (force || !existsSync(join(catalogs, "scan.pdf"))) {
  mkdirSync(join(catalogs, "sub"), { recursive: true });
  writeFileSync(join(catalogs, "basic.pdf"), readFileSync(join(out, "basic.pdf")));
  writeFileSync(join(catalogs, "sub", "languages.pdf"), readFileSync(join(out, "languages.pdf")));
  const scan = await PDFDocument.create();
  const px = new Uint8Array(200 * 100).fill(180);
  const img = scan.context.register(
    scan.context.flateStream(px, { Type: "XObject", Subtype: "Image", Width: 200, Height: 100, ColorSpace: "DeviceGray", BitsPerComponent: 8 }),
  );
  const page = scan.addPage([612, 792]);
  page.node.setXObject(PDFName.of("Im"), img);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(400, 0, 0, 200, 100, 400), drawObject("Im"), popGraphicsState());
  writeFileSync(join(catalogs, "scan.pdf"), await scan.save());
  writeFileSync(join(catalogs, "notes.txt"), "not a PDF");
  console.log("catalogs/ written");
}
