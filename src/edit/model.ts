/**
 * Non-destructive edit model.
 *
 * Nothing touches the PDF bytes while you work. Page order, rotation,
 * inserted/merged pages, annotations and form values are a small JSON-like
 * description layered over the untouched source files. That means:
 *   - edits on a 1 GB file are instant and cost bytes, not megabytes;
 *   - undo/redo is a pointer swap (immutable snapshots with structural sharing);
 *   - the original file is never at risk until you explicitly save.
 *
 * Coordinates are PDF user space (points, y up) of the *unrotated* page, so
 * annotations stay attached to content when pages are rotated or reordered.
 */
export type DocId = string;

export interface PageRef {
  /** Stable id; survives reordering. */
  id: string;
  /** Source document, or null for an inserted blank page. */
  docId: DocId | null;
  /** 0-based page index within the source document. */
  srcIndex: number;
  /** Rotation added by the user (0/90/180/270), on top of /Rotate. */
  rotation: number;
  /** Size for blank pages (points). */
  blank?: { width: number; height: number };
  /**
   * Shows only this part of the page: [x0, y0, x1, y1] in user space (a piece
   * made by "Cut pages"). Saved as the page's MediaBox/CropBox.
   */
  crop?: number[];
}

/**
 * A box placed while the page was displayed with rotation `rot`. (x, y) is
 * the user-space point under the box's *visual* bottom-left corner; w/h are
 * the visual width/height in points. Content inside (text, images) is drawn
 * rotated by `rot` so it looked upright when it was created.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

interface AnnotBase {
  id: string;
  pageId: string;
}

export type ShapeKind = "highlight" | "rect" | "ellipse" | "whiteout" | "redact";

export interface ShapeAnnot extends AnnotBase {
  type: ShapeKind;
  box: Box;
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface InkAnnot extends AnnotBase {
  type: "ink";
  /** Flat [x0, y0, x1, y1, ...] in user space. */
  points: number[];
  color: string;
  width: number;
  opacity: number;
}

export interface LineAnnot extends AnnotBase {
  type: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface TextAnnot extends AnnotBase {
  type: "text";
  box: Box;
  text: string;
  fontSize: number;
  color: string;
  /** Typeface; absent = sans. */
  font?: TextFont;
}

export interface ImageAnnot extends AnnotBase {
  type: "image";
  box: Box;
  imageId: string;
}

export interface NoteAnnot extends AnnotBase {
  type: "note";
  x: number;
  y: number;
  text: string;
  color: string;
}

export type Annotation = ShapeAnnot | InkAnnot | LineAnnot | TextAnnot | ImageAnnot | NoteAnnot;

export type FormValue = string | boolean | string[];

export interface EditState {
  pages: readonly PageRef[];
  annotations: readonly Annotation[];
  /** key = `${docId}|${fieldName}` */
  formValues: Readonly<Record<string, FormValue>>;
}

export interface StoredImage {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  url: string;
}

let counter = 0;
export function uid(prefix = "id"): string {
  counter = (counter + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyState(): EditState {
  return { pages: [], annotations: [], formValues: {} };
}

export function pagesForDoc(docId: DocId, numPages: number): PageRef[] {
  const out: PageRef[] = new Array(numPages);
  for (let i = 0; i < numPages; i++) out[i] = { id: uid("p"), docId, srcIndex: i, rotation: 0 };
  return out;
}

export function normRotation(r: number): number {
  return ((r % 360) + 360) % 360;
}

// ---------------------------------------------------------------- page ops

export function rotatePages(s: EditState, ids: Set<string>, delta: number): EditState {
  return {
    ...s,
    pages: s.pages.map((p) => (ids.has(p.id) ? { ...p, rotation: normRotation(p.rotation + delta) } : p)),
  };
}

export function deletePages(s: EditState, ids: Set<string>): EditState {
  const pages = s.pages.filter((p) => !ids.has(p.id));
  if (pages.length === 0) return s; // a PDF must keep at least one page
  return { ...s, pages, annotations: s.annotations.filter((a) => !ids.has(a.pageId)) };
}

/** Move the given pages so they start at `toIndex` (index in the result). */
export function movePages(s: EditState, ids: Set<string>, toIndex: number): EditState {
  const moving = s.pages.filter((p) => ids.has(p.id));
  const rest = s.pages.filter((p) => !ids.has(p.id));
  const at = Math.max(0, Math.min(rest.length, toIndex));
  return { ...s, pages: [...rest.slice(0, at), ...moving, ...rest.slice(at)] };
}

export function insertPages(s: EditState, at: number, pages: PageRef[]): EditState {
  const i = Math.max(0, Math.min(s.pages.length, at));
  return { ...s, pages: [...s.pages.slice(0, i), ...pages, ...s.pages.slice(i)] };
}

// ---------------------------------------------------------- annotation ops

export function addAnnotation(s: EditState, a: Annotation): EditState {
  return { ...s, annotations: [...s.annotations, a] };
}

export function updateAnnotation(s: EditState, id: string, patch: Partial<Annotation>): EditState {
  return {
    ...s,
    annotations: s.annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
  };
}

export function removeAnnotations(s: EditState, ids: Set<string>): EditState {
  return { ...s, annotations: s.annotations.filter((a) => !ids.has(a.id)) };
}

export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case "ink":
      return { ...a, points: a.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
    case "line":
    case "arrow":
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case "note":
      return { ...a, x: a.x + dx, y: a.y + dy };
    default:
      return { ...a, box: { ...a.box, x: a.box.x + dx, y: a.box.y + dy } };
  }
}

export function setFormValue(s: EditState, key: string, value: FormValue): EditState {
  return { ...s, formValues: { ...s.formValues, [key]: value } };
}

/** Rotation matrix helpers (degrees, counter-clockwise in user space). */
export function rotVec(rot: number, x: number, y: number): [number, number] {
  const r = (rot * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9;
  const s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return [x * c - y * s, x * s + y * c];
}

/** Axis-aligned user-space bounds of a box (for hit testing / search). */
export function boxBounds(b: Box): [number, number, number, number] {
  const pts = [
    [0, 0],
    [b.w, 0],
    [0, b.h],
    [b.w, b.h],
  ].map(([x, y]) => {
    const [rx, ry] = rotVec(b.rot, x, y);
    return [b.x + rx, b.y + ry];
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function annotationBounds(a: Annotation): [number, number, number, number] {
  switch (a.type) {
    case "ink": {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = 0; i < a.points.length; i += 2) {
        x0 = Math.min(x0, a.points[i]);
        x1 = Math.max(x1, a.points[i]);
        y0 = Math.min(y0, a.points[i + 1]);
        y1 = Math.max(y1, a.points[i + 1]);
      }
      const p = a.width / 2;
      return [x0 - p, y0 - p, x1 + p, y1 + p];
    }
    case "line":
    case "arrow":
      return [Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.max(a.x1, a.x2), Math.max(a.y1, a.y2)];
    case "note":
      return [a.x, a.y - 20, a.x + 20, a.y];
    default:
      return boxBounds(a.box);
  }
}

/** Text line baselines inside a text box, in the box's local frame (y down from top). */
/**
 * Fonts for typed text, on screen and in saved files (rasterized when the
 * text isn't Latin): Latin first, then Thai and Chinese faces found on
 * Windows, Apple devices and Linux. Keep src/styles.css (.text-editor) in sync.
 */
export const TEXT_FONTS =
  'Helvetica, Arial, "Leelawadee UI", Tahoma, Thonburi, "Noto Sans Thai", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

/**
 * Typeface for added text: "sans", "serif" or "mono" (the standard PDF fonts
 * Helvetica, Times and Courier: small files, readable everywhere), or the
 * family name of a font installed on this computer (embedded when saving).
 */
export type TextFont = string;

export const STANDARD_TEXT_FONTS = ["sans", "serif", "mono"] as const;

export function isStandardFont(f: TextFont | undefined): boolean {
  return !f || (STANDARD_TEXT_FONTS as readonly string[]).includes(f);
}

const NON_LATIN = '"Leelawadee UI", Tahoma, Thonburi, "Noto Sans Thai", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC"';

const TEXT_FONT_STACKS: Record<string, string> = {
  sans: TEXT_FONTS,
  serif: `"Times New Roman", Times, ${NON_LATIN}, serif`,
  mono: `"Courier New", Courier, ${NON_LATIN}, monospace`,
};

/** CSS font-family for a text annotation (Thai and Chinese fall back to system faces). */
export function textFontCss(a: { font?: TextFont }): string {
  const f = a.font ?? "sans";
  return TEXT_FONT_STACKS[f] ?? `"${f.replace(/["\\]/g, "")}", ${NON_LATIN}, sans-serif`;
}

export function textLines(a: Pick<TextAnnot, "text" | "fontSize">): { text: string; baseline: number }[] {
  return a.text.split("\n").map((text, i) => ({ text, baseline: a.fontSize * (0.95 + i * 1.25) }));
}

/** Simplify ink strokes (Ramer-Douglas-Peucker) to keep the model small. */
export function simplifyPoints(points: number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = points[s * 2],
      ay = points[s * 2 + 1],
      bx = points[e * 2],
      by = points[e * 2 + 1];
    const dx = bx - ax,
      dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1,
      idx = -1;
    for (let i = s + 1; i < e; i++) {
      const px = points[i * 2] - ax,
        py = points[i * 2 + 1] - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const qx = px - t * dx,
        qy = py - t * dy;
      const d = qx * qx + qy * qy;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > t2 && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}
