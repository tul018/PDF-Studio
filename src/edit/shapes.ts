/**
 * Shapes and arrow heads, as geometry the screen (SVG) and the saved PDF
 * (pdf-lib) both draw, so what you see is what is saved.
 */
import { cloudPath } from "./model";

export type ShapeKindName = "cloud" | "polygon" | "star" | "heart";

export interface ShapeSpec {
  kind: ShapeKindName;
  /** Polygon corners or star points: 3..12. */
  sides: number;
  /** Star: inner radius as a share of the outer one, 0.2..0.9. */
  inner: number;
}

export type ShapeFill = "none" | "light" | "solid";

/** A box shape's fill (color, opacity) or null; shapes made before fills had their own colour use the outline colour. */
export function fillOf(a: { color: string; opacity: number; fill?: ShapeFill; fillColor?: string; fillOpacity?: number }): { color: string; opacity: number } | null {
  if (a.fillColor !== undefined) return a.fillColor === "none" ? null : { color: a.fillColor, opacity: a.fillOpacity ?? 1 };
  if (!a.fill || a.fill === "none") return null;
  return { color: a.color, opacity: a.fill === "light" ? 0.25 : a.opacity };
}

export const DEFAULT_SHAPE: ShapeSpec = { kind: "polygon", sides: 6, inner: 0.5 };

/** Path in box-local space (0..w, 0..h, y up); `flip` negates y for pdf-lib. */
export function shapePath(spec: ShapeSpec, w: number, h: number, flip = false): string {
  if (spec.kind === "cloud") return cloudPath(w, h, flip);
  const fy = (y: number) => (flip ? -y : y);
  const f = (n: number) => Math.round(n * 100) / 100;
  if (spec.kind === "heart") {
    // Two lobes on top, the point at the bottom.
    const p = (x: number, y: number) => `${f(x * w)} ${f(fy(y * h))}`;
    return `M ${p(0.5, 0.06)} C ${p(0.2, 0.32)} ${p(-0.08, 0.62)} ${p(0.22, 0.92)} C ${p(0.36, 1.04)} ${p(0.5, 0.9)} ${p(0.5, 0.78)} C ${p(0.5, 0.9)} ${p(0.64, 1.04)} ${p(0.78, 0.92)} C ${p(1.08, 0.62)} ${p(0.8, 0.32)} ${p(0.5, 0.06)} Z`;
  }
  const n = Math.max(3, Math.min(12, Math.round(spec.sides)));
  const cx = w / 2,
    cy = h / 2;
  const pts: [number, number][] = [];
  const count = spec.kind === "star" ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    // Start at the top, go clockwise; star points alternate outer / inner.
    const a = Math.PI / 2 - (i * 2 * Math.PI) / count;
    const r = spec.kind === "star" && i % 2 ? Math.max(0.2, Math.min(0.9, spec.inner)) : 1;
    pts.push([cx + (w / 2) * r * Math.cos(a), cy + (h / 2) * r * Math.sin(a)]);
  }
  return pts.map(([x, y], i) => `${i ? "L" : "M"} ${f(x)} ${f(fy(y))}`).join(" ") + " Z";
}

export type HeadStyle = "none" | "open" | "closed" | "circle" | "bar";

/** What one arrow head is made of, in user space. */
export type HeadPart =
  | { kind: "lines"; points: number[][] } // open: two strokes meeting at the tip
  | { kind: "fill"; points: number[][] } // closed: a filled triangle
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "bar"; points: number[][] };

/** The head at (tx, ty), pointing away from (fx, fy). */
export function headPart(style: HeadStyle, fx: number, fy: number, tx: number, ty: number, width: number, size = 1): HeadPart | null {
  if (style === "none") return null;
  const ang = Math.atan2(ty - fy, tx - fx);
  const len = Math.max(8, width * 4) * size;
  if (style === "circle") return { kind: "circle", cx: tx, cy: ty, r: Math.max(3, width * 1.8) * size };
  if (style === "bar") {
    const s = len * 0.6;
    const nx = -Math.sin(ang) * s,
      ny = Math.cos(ang) * s;
    return { kind: "bar", points: [[tx + nx, ty + ny], [tx - nx, ty - ny]] };
  }
  const spread = Math.PI / 7;
  const a = [tx - len * Math.cos(ang - spread), ty - len * Math.sin(ang - spread)];
  const b = [tx - len * Math.cos(ang + spread), ty - len * Math.sin(ang + spread)];
  return style === "closed" ? { kind: "fill", points: [a, [tx, ty], b] } : { kind: "lines", points: [a, [tx, ty], b] };
}

/** Heads of a line: an arrow made before heads were adjustable has one open head at the end. */
export function headsOf(a: { type: "line" | "arrow"; start?: HeadStyle; end?: HeadStyle }): [HeadStyle, HeadStyle] {
  return [a.start ?? "none", a.end ?? (a.type === "arrow" ? "open" : "none")];
}

/** PDF /LE names for the saved annotation (editable in other apps). */
export const PDF_LINE_ENDING: Record<HeadStyle, string> = {
  none: "None",
  open: "OpenArrow",
  closed: "ClosedArrow",
  circle: "Circle",
  bar: "Butt",
};
