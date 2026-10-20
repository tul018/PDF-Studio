/**
 * Print layout: which pages go on which sheet. Pure functions (no PDF, no
 * DOM), so the plan the preview shows is exactly the plan that prints.
 */
export type PagesPerSheet = 1 | 2 | 4 | 6;
export type Layout = PagesPerSheet | "booklet";
export type Subset = "all" | "odd" | "even";

export interface Sheet {
  /** Page index per cell, row by row; null = empty cell. */
  cells: (number | null)[];
  cols: number;
  rows: number;
  /** Sheet turned sideways. */
  landscape: boolean;
}

/** Odd/even counts the chosen pages (1st, 3rd, ...), like Acrobat and Word. */
export function choosePages(pages: number[], subset: Subset, reverse: boolean): number[] {
  const out = subset === "all" ? pages.slice() : pages.filter((_, i) => (subset === "odd" ? i % 2 === 0 : i % 2 === 1));
  return reverse ? out.reverse() : out;
}

/** [more, fewer] cells across the sheet's long and short side; sideways by default? */
const GRID: Record<PagesPerSheet, [number, number, boolean]> = {
  1: [1, 1, false],
  2: [2, 1, true],
  4: [2, 2, false],
  6: [3, 2, false],
};

/**
 * Sheets for the pages. One per sheet follows each page's own orientation
 * (`pageLandscape`) unless `orientation` fixes it. Booklet: pages padded to a
 * multiple of 4 and arranged so the printed sheets, folded in half after
 * double-sided printing (flip on the short edge), read in order.
 */
export function planSheets(
  pages: number[],
  layout: Layout,
  pageLandscape: (index: number) => boolean,
  orientation: "auto" | "portrait" | "landscape" = "auto",
): Sheet[] {
  if (!pages.length) return [];
  const fixed = orientation === "auto" ? null : orientation === "landscape";
  if (layout === "booklet") {
    const n = Math.ceil(pages.length / 4) * 4;
    const p = (i: number) => (i < pages.length ? pages[i] : null);
    const out: Sheet[] = [];
    for (let k = 0; k < n / 4; k++) {
      out.push({ cells: [p(n - 1 - 2 * k), p(2 * k)], cols: 2, rows: 1, landscape: true });
      out.push({ cells: [p(2 * k + 1), p(n - 2 - 2 * k)], cols: 2, rows: 1, landscape: true });
    }
    return out;
  }
  const [long, short, land] = GRID[layout];
  const per = long * short;
  const out: Sheet[] = [];
  for (let i = 0; i < pages.length; i += per) {
    const cells: (number | null)[] = pages.slice(i, i + per);
    while (cells.length < per) cells.push(null);
    const landscape = fixed ?? (layout === 1 ? pageLandscape(pages[i]) : land);
    // A sideways sheet is wide: more cells across; upright: more down.
    out.push({ cells, cols: landscape ? long : short, rows: landscape ? short : long, landscape });
  }
  return out;
}

/** Paper sizes in points (portrait). */
export const PAPER: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
  Legal: [612, 1008],
};
