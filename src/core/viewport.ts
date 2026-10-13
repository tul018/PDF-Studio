/**
 * Same maths as PDF.js' PageViewport, but usable for blank pages and without
 * a loaded PDFPageProxy. Maps unrotated user space (y up) <-> CSS pixels.
 */
export type Matrix = [number, number, number, number, number, number];

export interface View {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  transform: Matrix;
  toView(x: number, y: number): [number, number];
  toPdf(x: number, y: number): [number, number];
}

export function makeView(viewBox: number[], scale: number, rotation: number): View {
  const [x0, y0, x1, y1] = viewBox;
  const cx = (x1 + x0) / 2;
  const cy = (y1 + y0) / 2;
  rotation = ((rotation % 360) + 360) % 360;
  let a: number, b: number, c: number, d: number;
  switch (rotation) {
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  let ox: number, oy: number, width: number, height: number;
  if (a === 0) {
    ox = Math.abs(cy - y0) * scale;
    oy = Math.abs(cx - x0) * scale;
    width = (y1 - y0) * scale;
    height = (x1 - x0) * scale;
  } else {
    ox = Math.abs(cx - x0) * scale;
    oy = Math.abs(cy - y0) * scale;
    width = (x1 - x0) * scale;
    height = (y1 - y0) * scale;
  }
  const m: Matrix = [
    a * scale,
    b * scale,
    c * scale,
    d * scale,
    ox - a * scale * cx - c * scale * cy,
    oy - b * scale * cx - d * scale * cy,
  ];
  const det = m[0] * m[3] - m[1] * m[2];
  return {
    width,
    height,
    scale,
    rotation,
    transform: m,
    toView: (x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]],
    toPdf: (x, y) => [
      ((x - m[4]) * m[3] - (y - m[5]) * m[2]) / det,
      ((y - m[5]) * m[0] - (x - m[4]) * m[1]) / det,
    ],
  };
}

/** View-space rect -> normalized [left, top, right, bottom]. */
export function viewRect(v: View, pdfRect: number[]): [number, number, number, number] {
  const [ax, ay] = v.toView(pdfRect[0], pdfRect[1]);
  const [bx, by] = v.toView(pdfRect[2], pdfRect[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
