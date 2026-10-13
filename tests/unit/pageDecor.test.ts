import { describe, expect, it } from "vitest";
import { makeView } from "../../src/core/viewport";
import { emptyState, pagesForDoc, type EditState } from "../../src/edit/model";
import {
  boxAt,
  DEFAULT_PAGE_NUMBERS,
  imageOnPages,
  PAGE_NUMBER_PREFIX,
  pageNumberAnnotations,
  replaceByPrefix,
  WATERMARK_PREFIX,
} from "../../src/edit/pageDecor";

const A4 = [0, 0, 595, 842];
const measure = (t: string, size: number) => t.length * size * 0.5;

/** Where a box's visual top-left corner and size end up on screen (points). */
function visual(viewBox: number[], rotation: number, b: { x: number; y: number; w: number; h: number }) {
  const v = makeView(viewBox, 1, rotation);
  const [vx, vy] = v.toView(b.x, b.y); // visual bottom-left
  return { left: Math.round(vx), top: Math.round(vy - b.h), right: Math.round(vx + b.w), bottom: Math.round(vy), W: v.width, H: v.height };
}

describe("page decorations", () => {
  it("places boxes where the reader sees them, also on rotated pages", () => {
    for (const rotation of [0, 90, 180, 270]) {
      const b = boxAt({ viewBox: A4, rotation }, 100, 40, "bottom-right", 20);
      const r = visual(A4, rotation, b);
      expect(b.rot).toBe(rotation);
      expect(r.right).toBe(Math.round(r.W - 20));
      expect(r.bottom).toBe(Math.round(r.H - 20));
      const t = visual(A4, rotation, boxAt({ viewBox: A4, rotation }, 100, 40, "top-left", 20));
      expect([t.left, t.top]).toEqual([20, 20]);
    }
  });

  it("numbers pages in the chosen format, optionally skipping the cover", () => {
    const pages = pagesForDoc("d", 4);
    const geom = () => ({ viewBox: A4, rotation: 0 });
    const all = pageNumberAnnotations(pages, geom, DEFAULT_PAGE_NUMBERS, measure);
    expect(all.map((a) => a.text)).toEqual(["Page 1 of 4", "Page 2 of 4", "Page 3 of 4", "Page 4 of 4"]);
    expect(all.every((a) => a.id.startsWith(PAGE_NUMBER_PREFIX))).toBe(true);
    const thai = pageNumberAnnotations(pages, geom, { ...DEFAULT_PAGE_NUMBERS, format: "หน้า {n}/{total}", skipFirst: true }, measure);
    expect(thai.map((a) => [a.pageId, a.text])).toEqual([
      [pages[1].id, "หน้า 1/3"],
      [pages[2].id, "หน้า 2/3"],
      [pages[3].id, "หน้า 3/3"],
    ]);
    // Centered at the bottom.
    const r = visual(A4, 0, all[0].box);
    expect(Math.abs((r.left + r.right) / 2 - 595 / 2)).toBeLessThanOrEqual(1);
  });

  it("running it again replaces the previous set (one undo step)", () => {
    const pages = pagesForDoc("d", 2);
    const geom = () => ({ viewBox: A4, rotation: 0 });
    let s: EditState = { ...emptyState(), pages };
    s = replaceByPrefix(s, PAGE_NUMBER_PREFIX, pageNumberAnnotations(pages, geom, DEFAULT_PAGE_NUMBERS, measure));
    s = replaceByPrefix(s, WATERMARK_PREFIX, imageOnPages(pages, geom, "img1", 800, 400, { position: "middle-center", widthFraction: 0.7, idPrefix: WATERMARK_PREFIX }));
    s = replaceByPrefix(s, PAGE_NUMBER_PREFIX, pageNumberAnnotations(pages, geom, { ...DEFAULT_PAGE_NUMBERS, format: "{n}" }, measure));
    expect(s.annotations).toHaveLength(4);
    expect(s.annotations.filter((a) => a.type === "text").map((a) => (a as { text: string }).text)).toEqual(["1", "2"]);
  });

  it("watermark: 70% of the page width, centered, kept inside tall images", () => {
    const pages = pagesForDoc("d", 1);
    const [wm] = imageOnPages(pages, () => ({ viewBox: A4, rotation: 0 }), "i", 1000, 300, { position: "middle-center", widthFraction: 0.7, idPrefix: WATERMARK_PREFIX });
    expect(Math.round(wm.box.w)).toBe(Math.round(595 * 0.7));
    const r = visual(A4, 0, wm.box);
    expect(Math.abs((r.top + r.bottom) / 2 - 421)).toBeLessThanOrEqual(1);
    const [tall] = imageOnPages(pages, () => ({ viewBox: A4, rotation: 0 }), "i", 300, 3000, { position: "middle-center", widthFraction: 0.7, idPrefix: WATERMARK_PREFIX });
    expect(tall.box.h).toBeLessThanOrEqual(842 * 0.7 + 0.01);
  });
});
