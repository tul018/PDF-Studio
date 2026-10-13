import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from "pdf-lib";

/**
 * Shrink a PDF: re-compress its pictures (the bulk of nearly every big PDF).
 * Images larger than the chosen level are scaled down and saved as JPEG; an
 * image is only replaced when that makes it smaller. Text, vectors and fonts
 * are untouched. Image kinds that can't be safely redone (masks, JPEG 2000,
 * JBIG2, indexed colours, PNG predictors, soft masks) are left as they are.
 * Runs in a worker (OffscreenCanvas + createImageBitmap).
 */
export type ShrinkLevel = "small" | "balanced" | "high";

const LEVELS: Record<ShrinkLevel, { maxSide: number; quality: number }> = {
  small: { maxSide: 1200, quality: 0.6 },
  balanced: { maxSide: 1800, quality: 0.72 },
  high: { maxSide: 2600, quality: 0.85 },
};

export interface ShrinkResult {
  bytes: Uint8Array;
  images: number;
  redone: number;
}

const N = (s: string) => PDFName.of(s);

export async function shrinkPdf(input: Uint8Array, level: ShrinkLevel, onProgress: (f: number) => void = () => {}): Promise<ShrinkResult> {
  const { maxSide, quality } = LEVELS[level];
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const ctx = doc.context;
  const images = ctx
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && o.dict.get(N("Subtype")) === N("Image"));
  let redone = 0;
  for (const [k, [ref, obj]] of images.entries()) {
    const stream = obj as PDFRawStream;
    try {
      const next = await recompress(stream, maxSide, quality);
      if (next && next.bytes.length < stream.contents.length * 0.9) {
        const dict = stream.dict.clone(ctx);
        dict.set(N("Filter"), N("DCTDecode"));
        dict.set(N("Width"), PDFNumber.of(next.width));
        dict.set(N("Height"), PDFNumber.of(next.height));
        dict.set(N("ColorSpace"), N(next.gray ? "DeviceGray" : "DeviceRGB"));
        dict.set(N("BitsPerComponent"), PDFNumber.of(8));
        for (const key of ["DecodeParms", "Decode", "Length"]) dict.delete(N(key));
        ctx.assign(ref, PDFRawStream.of(dict, next.bytes));
        redone++;
      }
    } catch {
      /* leave this image as it was */
    }
    onProgress((k + 1) / Math.max(1, images.length));
  }
  return { bytes: await doc.save({ useObjectStreams: true }), images: images.length, redone };
}

function name(o: PDFObject | undefined): string | undefined {
  return o instanceof PDFName ? o.decodeText() : undefined;
}

async function recompress(s: PDFRawStream, maxSide: number, quality: number): Promise<{ bytes: Uint8Array; width: number; height: number; gray: boolean } | null> {
  const d = s.dict;
  if (d.get(N("ImageMask")) || d.get(N("SMask")) || d.get(N("Mask")) || d.get(N("SMaskInData"))) return null;
  const filters = d.get(N("Filter"));
  const filter = name(filters);
  const w = (d.get(N("Width")) as PDFNumber)?.asNumber?.() ?? 0;
  const h = (d.get(N("Height")) as PDFNumber)?.asNumber?.() ?? 0;
  if (!w || !h) return null;
  const big = Math.max(w, h) > maxSide;
  const cs = name(d.get(N("ColorSpace")));
  let bitmap: ImageBitmap;
  let gray = cs === "DeviceGray";
  if (filter === "DCTDecode") {
    // JPEG already: only worth redoing when it's bigger than needed.
    if (!big && s.contents.length < w * h * 0.25) return null;
    if (cs === "DeviceCMYK" || d.get(N("Decode"))) return null; // inverted CMYK JPEGs: leave alone
    bitmap = await createImageBitmap(new Blob([s.contents as BlobPart], { type: "image/jpeg" }));
  } else if (filter === "FlateDecode" && !d.get(N("DecodeParms"))) {
    const bpc = (d.get(N("BitsPerComponent")) as PDFNumber)?.asNumber?.();
    if (bpc !== 8 || (cs !== "DeviceRGB" && cs !== "DeviceGray")) return null;
    const raw = await inflate(s.contents);
    const comps = cs === "DeviceGray" ? 1 : 3;
    if (raw.length < w * h * comps) return null;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      rgba[i * 4] = raw[j];
      rgba[i * 4 + 1] = raw[j + (comps === 3 ? 1 : 0)];
      rgba[i * 4 + 2] = raw[j + (comps === 3 ? 2 : 0)];
      rgba[i * 4 + 3] = 255;
    }
    bitmap = await createImageBitmap(new ImageData(rgba, w, h));
  } else {
    return null;
  }
  const k = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * k)),
    th = Math.max(1, Math.round(h * k));
  const canvas = new OffscreenCanvas(tw, th);
  const c2d = canvas.getContext("2d")!;
  c2d.imageSmoothingQuality = "high";
  c2d.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  gray = false; // canvas JPEGs are RGB
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: tw, height: th, gray };
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

void PDFDict;
