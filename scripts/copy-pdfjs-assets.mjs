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
