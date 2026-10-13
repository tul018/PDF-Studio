import { PDFDocument } from "pdf-lib";

/**
 * Make a PDF from photos or scans: one image per page, on A4 turned to match
 * the image, filling the page with a small margin. Optional clean-up per
 * image: trim the empty (paper/background-coloured) border, and a "scan
 * look" (grey, white paper, dark ink) that makes receipts and documents
 * read better and the file smaller.
 */
export interface FromImagesOptions {
  trim: boolean;
  scanLook: boolean;
  /** Longest side in pixels (keeps files reasonable; 2400 px ~ 200 dpi on A4). */
  maxSide?: number;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 12;

export async function imagesToPdf(files: readonly Blob[], o: FromImagesOptions, onProgress: (f: number) => void = () => {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [i, f] of files.entries()) {
    const { bytes, width, height } = await prepare(f, o);
    const img = await doc.embedJpg(bytes);
    const landscape = width > height;
    const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
    const k = Math.min((pw - 2 * MARGIN) / width, (ph - 2 * MARGIN) / height);
    const w = width * k,
      h = height * k;
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    onProgress((i + 1) / files.length);
  }
  return doc.save({ useObjectStreams: true });
}

async function prepare(file: Blob, o: FromImagesOptions): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  // createImageBitmap applies the photo's EXIF orientation (phone pictures come out upright).
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const max = o.maxSide ?? 2400;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  let c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  let ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  if (o.scanLook) scanLook(ctx, c.width, c.height);
  if (o.trim) {
    const r = contentBox(ctx, c.width, c.height);
    if (r && (r.w < c.width * 0.97 || r.h < c.height * 0.97)) {
      const t = document.createElement("canvas");
      t.width = r.w;
      t.height = r.h;
      t.getContext("2d")!.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      c.width = c.height = 0;
      c = t;
      ctx = c.getContext("2d")!;
    }
  }
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/jpeg", o.scanLook ? 0.82 : 0.88));
  const out = { bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
  c.width = c.height = 0;
  return out;
}

/** Grey, paper pushed to white and ink to black (levels from the image's own histogram). */
function scanLook(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    hist[g | 0]++;
  }
  const n = w * h;
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n * p) return v;
    return 255;
  };
  const black = pct(0.02),
    white = Math.max(black + 10, pct(0.6)); // most of a document is paper
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - black) * 255) / (white - black)));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

/** The area that differs from the border colour (with a little padding), or null. */
function contentBox(ctx: CanvasRenderingContext2D, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const d = ctx.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number) => (y * w + x) * 4;
  // Background = average of the four corners.
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + d[i + c], 0) / 4);
  const differs = (i: number) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 600)); // sampled: fast on big photos
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (!differs(at(x, y))) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.min(w, h) * 0.02);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
