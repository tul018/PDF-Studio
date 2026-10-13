import { describe, expect, it } from "vitest";
import { cutPages, pieceCrop, pieces } from "../../src/edit/cut";
import { emptyState, pagesForDoc, type Annotation, type EditState } from "../../src/edit/model";

const A4 = [0, 0, 600, 800];

describe("cut pages", () => {
  it("pieces in reading order: vertical, horizontal, both, at any percentage", () => {
    expect(pieces({ x: 0.5 })).toEqual([[0, 0, 0.5, 1], [0.5, 0, 1, 1]]);
    expect(pieces({ y: 0.3 })).toEqual([[0, 0, 1, 0.3], [0, 0.3, 1, 1]]);
    expect(pieces({ x: 0.4, y: 0.5 })).toEqual([
      [0, 0, 0.4, 0.5],
      [0.4, 0, 1, 0.5],
      [0, 0.5, 0.4, 1],
      [0.4, 0.5, 1, 1],
    ]);
    expect(pieces({ x: 0, y: 1 })).toEqual([[0, 0, 1, 1]]); // cuts at the edge do nothing
  });

  it("maps what the reader sees to the page, rotated or not", () => {
    // Top-left 40% x 50% of an upright page: x 0..240, y (from the bottom) 400..800.
    expect(pieceCrop({ viewBox: A4, rotation: 0 }, [0, 0, 0.4, 0.5])).toEqual([0, 400, 240, 800]);
    // Turned 90° clockwise, the visual top-left is the page's bottom-left corner region.
    const c = pieceCrop({ viewBox: A4, rotation: 90 }, [0, 0, 0.5, 0.5]);
    expect(c).toEqual([0, 0, 300, 400]);
  });

  it("replaces each chosen page by its pieces, moves annotations along, one undo step", () => {
    const pages = pagesForDoc("d", 3);
    const note: Annotation = { id: "n1", pageId: pages[1].id, type: "note", x: 500, y: 100, text: "", color: "#ff0" }; // bottom right
    const box: Annotation = {
      id: "b1",
      pageId: pages[1].id,
      type: "rect",
      box: { x: 20, y: 700, w: 50, h: 40, rot: 0 }, // top left
      color: "#f00",
      strokeWidth: 1,
      opacity: 1,
    };
    const s: EditState = { ...emptyState(), pages, annotations: [note, box] };
    const out = cutPages(s, new Set([pages[1].id]), { x: 0.5, y: 0.5 }, () => ({ viewBox: A4, rotation: 0 }));
    expect(out.pages).toHaveLength(6);
    expect(out.pages[0]).toBe(pages[0]);
    expect(out.pages[5]).toBe(pages[2]);
    const cut = out.pages.slice(1, 5);
    expect(cut.map((p) => p.crop)).toEqual([
      [0, 400, 300, 800],
      [300, 400, 600, 800],
      [0, 0, 300, 400],
      [300, 0, 600, 400],
    ]);
    expect(cut.every((p) => p.docId === "d" && p.srcIndex === 1)).toBe(true);
    expect(out.annotations.find((a) => a.id === "b1")!.pageId).toBe(cut[0].id);
    expect(out.annotations.find((a) => a.id === "n1")!.pageId).toBe(cut[3].id);
  });

  it("a piece can be cut again", () => {
    const [p] = pagesForDoc("d", 1);
    const s1 = cutPages({ ...emptyState(), pages: [p] }, new Set([p.id]), { x: 0.5 }, () => ({ viewBox: A4, rotation: 0 }));
    const right = s1.pages[1];
    const s2 = cutPages(s1, new Set([right.id]), { y: 0.5 }, (q) => ({ viewBox: q.crop!, rotation: 0 }));
    expect(s2.pages.map((q) => q.crop)).toEqual([
      [0, 0, 300, 800],
      [300, 400, 600, 800],
      [300, 0, 600, 400],
    ]);
  });
});
