// Copies the PDF.js runtime assets (CMaps, standard fonts, ICC profiles and
// the JPEG2000/JBIG2 WebAssembly decoders) into public/ so they are served
// locally. Nothing is fetched from a CDN at runtime -> works offline on
// Windows and iOS.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = join(src, dir);
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true });
}
console.log("PDF.js assets copied to public/pdfjs");

// OCR (Tesseract): worker, WebAssembly engine (with and without SIMD) and the
// Thai / Chinese / English language data, also served locally (offline).
const ocr = join(root, "public", "tesseract");
if (existsSync(ocr)) rmSync(ocr, { recursive: true, force: true });
mkdirSync(join(ocr, "lang"), { recursive: true });
const tjs = join(root, "node_modules", "tesseract.js", "dist", "worker.min.js");
if (existsSync(tjs)) {
  cpSync(tjs, join(ocr, "worker.min.js"));
  for (const f of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) {
    cpSync(join(root, "node_modules", "tesseract.js-core", f), join(ocr, f));
  }
  for (const lang of ["tha", "chi_sim", "eng"]) {
    cpSync(join(root, "node_modules", "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`), join(ocr, "lang", `${lang}.traineddata.gz`));
  }
  console.log("OCR assets copied to public/tesseract");
}
