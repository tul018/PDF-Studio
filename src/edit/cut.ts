import { makeView } from "../core/viewport";
import { rotVec, uid, type Annotation, type EditState, type PageRef } from "./model";
import type { PageGeom } from "./pageDecor";

/**
 * Cut pages into pieces: a vertical cut at `x` and/or a horizontal cut at
 * `y` (fractions of the page as the reader sees it: x from the left, y from
 * the top). Each page becomes 2 or 4 pages in reading order, each showing
 * one piece (PageRef.crop). Nothing in the file changes until saving, and
 * one undo restores the pages. Not a redaction: content outside a piece is
 * hidden, not removed.
 */
export interface Cut {
  x?: number;
  y?: number;
}

/** Visual pieces as fractions [left, top, right, bottom], in reading order. */
export function pieces(cut: Cut): [number, number, number, number][] {
  const xs = [0, ...(cut.x !== undefined && cut.x > 0 && cut.x < 1 ? [cut.x] : []), 1];
  const ys = [0, ...(cut.y !== undefined && cut.y > 0 && cut.y < 1 ? [cut.y] : []), 1];
  const out: [number, number, number, number][] = [];
  for (let r = 0; r + 1 < ys.length; r++) for (let c = 0; c + 1 < xs.length; c++) out.push([xs[c], ys[r], xs[c + 1], ys[r + 1]]);
  return out;
}

/** A visual piece of a page -> the user-space rectangle it shows [x0, y0, x1, y1]. */
export function pieceCrop(g: PageGeom, piece: [number, number, number, number]): number[] {
  const v = makeView(g.viewBox, 1, g.rotation);
  const [l, t, r, b] = piece;
  const [ax, ay] = v.toPdf(l * v.width, t * v.height);
  const [bx, by] = v.toPdf(r * v.width, b * v.height);
  // Rounded to 1/1000 pt (no floating-point noise, no -0).
  const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)].map(r3);
}

/** A point of the annotation (user space) that decides which piece it goes with. */
function anchor(a: Annotation): [number, number] {
  switch (a.type) {
    case "ink": {
      let x = 0,
        y = 0;
      const n = a.points.length / 2;
      for (let i = 0; i < a.points.length; i += 2) {
        x += a.points[i];
        y += a.points[i + 1];
      }
      return [x / Math.max(1, n), y / Math.max(1, n)];
    }
    case "line":
    case "arrow":
      return [(a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2];
    case "note":
      return [a.x, a.y];
    default: {
      const [dx, dy] = rotVec(a.box.rot, a.box.w / 2, a.box.h / 2);
      return [a.box.x + dx, a.box.y + dy];
    }
  }
}

const inside = (c: number[], [x, y]: [number, number]) => x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3];

/** Cut the pages with ids in `ids`; `geom` is how each page is shown now (already cropped pages can be cut again). */
export function cutPages(s: EditState, ids: ReadonlySet<string>, cut: Cut, geom: (p: PageRef) => PageGeom): EditState {
  const parts = pieces(cut);
  if (parts.length < 2) return s;
  const moved = new Map<string, string>(); // annotation id -> new page id
  const pages: PageRef[] = [];
  for (const p of s.pages) {
    if (!ids.has(p.id) || !p.docId) {
      pages.push(p);
      continue;
    }
    const g = geom(p);
    const made = parts.map((piece) => ({ ...p, id: uid("p"), crop: pieceCrop(g, piece) }));
    pages.push(...made);
    for (const a of s.annotations) {
      if (a.pageId !== p.id) continue;
      const pt = anchor(a);
      moved.set(a.id, (made.find((m) => inside(m.crop, pt)) ?? made[0]).id);
    }
  }
  return {
    ...s,
    pages,
    annotations: s.annotations.map((a) => (moved.has(a.id) ? { ...a, pageId: moved.get(a.id)! } : a)),
  };
}
