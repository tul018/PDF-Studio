import { TEXT_FONTS } from "./model";

/**
 * Stamps: rubber-stamp style text (PAID, ได้รับเงินแล้ว, สำเนาถูกต้อง...) and
 * the user's own images (company seal, logo, signature scan), as transparent
 * PNGs placed like any image. Text is drawn with system fonts, so Thai and
 * Chinese render properly.
 */
export interface TextStamp {
  text: string;
  color: string;
}

export const BUILTIN_STAMPS: TextStamp[] = [
  { text: "PAID", color: "#15803d" },
  { text: "ได้รับเงินแล้ว", color: "#15803d" },
  { text: "APPROVED", color: "#1d4ed8" },
  { text: "อนุมัติ", color: "#1d4ed8" },
  { text: "สำเนาถูกต้อง", color: "#1d4ed8" },
  { text: "COPY", color: "#1d4ed8" },
  { text: "RECEIVED", color: "#7c3aed" },
  { text: "ได้รับแล้ว", color: "#7c3aed" },
  { text: "CONFIDENTIAL", color: "#dc2626" },
  { text: "ลับ", color: "#dc2626" },
  { text: "DRAFT", color: "#6b7280" },
  { text: "CANCELLED", color: "#dc2626" },
  { text: "ยกเลิก", color: "#dc2626" },
];

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));

/** Today's date, written the local way (Thai stamps get the Buddhist year). */
export function stampDate(text: string, d = new Date()): string {
  const thai = /[฀-๿]/.test(text);
  return d.toLocaleDateString(thai ? "th-TH" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A rubber-stamp look: bold text in a double rounded frame, optional date line. */
export async function renderTextStamp(s: TextStamp, withDate: boolean): Promise<Blob> {
  const k = 3; // render at 3x for sharp print
  const size = 40 * k;
  const font = `700 ${size}px ${TEXT_FONTS}`;
  const dateFont = `600 ${size * 0.42}px ${TEXT_FONTS}`;
  const date = withDate ? stampDate(s.text) : "";
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = font;
  const tw = m.measureText(s.text).width;
  m.font = dateFont;
  const dw = date ? m.measureText(date).width : 0;
  const pad = 18 * k;
  const w = Math.ceil(Math.max(tw, dw) + pad * 2);
  const h = Math.ceil(size * 1.35 + (date ? size * 0.6 : 0) + pad);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.globalAlpha = 0.88;
  ctx.strokeStyle = ctx.fillStyle = s.color;
  const frame = (inset: number, lw: number) => {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, 10 * k);
    ctx.stroke();
  };
  frame(3 * k, 3 * k);
  frame(7.5 * k, 1.2 * k);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font;
  ctx.fillText(s.text, w / 2, pad / 2 + size * 0.72);
  if (date) {
    ctx.font = dateFont;
    ctx.fillText(date, w / 2, h - pad / 2 - size * 0.32);
  }
  return toBlob(c);
}

/** Large faint diagonal text across the page. */
export async function renderWatermark(text: string, color: string, opacity: number, angleDeg = -35): Promise<Blob> {
  const size = 160;
  const font = `700 ${size}px ${TEXT_FONTS}`;
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = font;
  const tw = m.measureText(text).width;
  const th = size * 1.2;
  const a = (angleDeg * Math.PI) / 180;
  const w = Math.ceil(Math.abs(tw * Math.cos(a)) + Math.abs(th * Math.sin(a)));
  const h = Math.ceil(Math.abs(tw * Math.sin(a)) + Math.abs(th * Math.cos(a)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.globalAlpha = Math.min(1, Math.max(0.03, opacity));
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(w / 2, h / 2);
  ctx.rotate(a);
  ctx.fillText(text, 0, 0);
  return toBlob(c);
}

/**
 * A scanned or photographed seal on white paper: make the paper transparent
 * (soft edge between light grey and white) and trim the empty border.
 */
export async function removeWhiteBackground(blob: Blob, maxSide = 1000): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)),
    h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const keep = lum >= 235 ? 0 : lum <= 200 ? 1 : (235 - lum) / 35;
    d[i + 3] = Math.round(d[i + 3] * keep);
    if (d[i + 3] > 16) {
      const p = i / 4,
        x = p % w,
        y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (x1 < 0) return toBlob(c); // all white: leave as is
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return toBlob(out);
}

/** Any image as a PNG at most maxSide pixels (saved stamps stay small). */
export async function shrinkToPng(blob: Blob, maxSide = 1000): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return toBlob(c);
}

// ------------------------------------------------------------ the user's own stamps

export interface SavedStamp {
  id: string;
  name: string;
  /** PNG data URL (kept small: seals are downscaled to 1000 px). */
  dataUrl: string;
}

const KEY = "pdfstudio:stamps";

export function savedStamps(): SavedStamp[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function saveStamp(name: string, png: Blob): Promise<SavedStamp> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(png);
  });
  const s: SavedStamp = { id: `s${Date.now().toString(36)}`, name, dataUrl };
  localStorage.setItem(KEY, JSON.stringify([...savedStamps(), s])); // throws when storage is full
  return s;
}

export function deleteStamp(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(savedStamps().filter((s) => s.id !== id)));
  } catch {
    /* ignore */
  }
}

export const dataUrlToBlob = (url: string) => fetch(url).then((r) => r.blob());
