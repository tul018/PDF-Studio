import { makeView } from "../core/viewport";
import { uid, type Annotation, type Box, type EditState, type ImageAnnot, type PageRef, type TextAnnot } from "./model";

/**
 * Things added to many pages at once: page numbers, watermarks, a stamp on
 * every page. They are ordinary annotations (movable, deletable, saved like
 * any other) whose ids carry a prefix, so running the same command again
 * replaces the previous set instead of stacking a second one.
 */
export const PAGE_NUMBER_PREFIX = "pn-";
export const WATERMARK_PREFIX = "wm-";
export const STAMP_PREFIX = "st-";

export type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** A page as it is displayed: its view box and total rotation. */
export interface PageGeom {
  viewBox: number[];
  rotation: number;
}

/**
 * A w x h point box at `pos` on the page as the reader sees it (rotation
 * applied), `margin` points from the edges.
 */
export function boxAt(g: PageGeom, w: number, h: number, pos: Position, margin = 28): Box {
  const v = makeView(g.viewBox, 1, g.rotation);
  const [vert, horiz] = pos.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];
  const x = horiz === "left" ? margin : horiz === "right" ? v.width - w - margin : (v.width - w) / 2;
  const y = vert === "top" ? margin : vert === "bottom" ? v.height - h - margin : (v.height - h) / 2;
  // Anchored at the visual bottom-left corner, drawn rotated with the page.
  const [px, py] = v.toPdf(x, y + h);
  return { x: px, y: py, w, h, rot: v.rotation };
}

export const PAGE_NUMBER_FORMATS = [
  "{n}",
  "Page {n}",
  "Page {n} of {total}",
  "{n} / {total}",
  "- {n} -",
  "หน้า {n}",
  "หน้า {n}/{total}",
  "第 {n} 页",
] as const;

export interface PageNumberOptions {
  format: string;
  position: Position;
  fontSize: number;
  color: string;
  /** Number given to the first numbered page. */
  start: number;
  /** Leave the first page (a cover) without a number. */
  skipFirst: boolean;
}

export const DEFAULT_PAGE_NUMBERS: PageNumberOptions = {
  format: "Page {n} of {total}",
  position: "bottom-center",
  fontSize: 10,
  color: "#000000",
  start: 1,
  skipFirst: false,
};

/** Page number text boxes for every page (`measure` gives a text's width in points). */
export function pageNumberAnnotations(
  pages: readonly PageRef[],
  geom: (p: PageRef) => PageGeom,
  o: PageNumberOptions,
  measure: (text: string, fontSize: number) => number,
): TextAnnot[] {
  const numbered = o.skipFirst ? pages.slice(1) : pages;
  const total = numbered.length + o.start - 1;
  return numbered.map((p, i) => {
    const text = o.format.replace(/\{n\}/g, String(o.start + i)).replace(/\{total\}/g, String(total));
    // Same box maths as a typed text box (overlay.commitTextEdit).
    const w = measure(text, o.fontSize) + 6;
    const h = o.fontSize * 1.7;
    return {
      id: uid(PAGE_NUMBER_PREFIX),
      pageId: p.id,
      type: "text",
      box: boxAt(geom(p), w, h, o.position, 20),
      text,
      fontSize: o.fontSize,
      color: o.color,
    };
  });
}

/**
 * The same image on every page: a stamp in a corner, or a watermark across
 * the middle (`widthFraction` of the page width, kept inside the page).
 */
export function imageOnPages(
  pages: readonly PageRef[],
  geom: (p: PageRef) => PageGeom,
  imageId: string,
  imgW: number,
  imgH: number,
  o: { position: Position; widthPt?: number; widthFraction?: number; idPrefix: string },
): ImageAnnot[] {
  return pages.map((p) => {
    const g = geom(p);
    const v = makeView(g.viewBox, 1, g.rotation);
    let w = o.widthFraction ? v.width * o.widthFraction : (o.widthPt ?? 150);
    let h = (w * imgH) / imgW;
    const maxH = v.height * (o.widthFraction ?? 0.5);
    if (h > maxH) {
      w *= maxH / h;
      h = maxH;
    }
    return { id: uid(o.idPrefix), pageId: p.id, type: "image", box: boxAt(g, w, h, o.position), imageId };
  });
}

/** Replace the annotations of one kind (by id prefix) with a new set, as one undo step. */
export function replaceByPrefix(s: EditState, prefix: string, added: readonly Annotation[]): EditState {
  return { ...s, annotations: [...s.annotations.filter((a) => !a.id.startsWith(prefix)), ...added] };
}
