import { describe, expect, it } from "vitest";
import { History } from "../../src/edit/history";
import {
  addAnnotation,
  deletePages,
  emptyState,
  movePages,
  pagesForDoc,
  rotatePages,
  simplifyPoints,
  translateAnnotation,
  type Annotation,
} from "../../src/edit/model";

const base = () => ({ ...emptyState(), pages: pagesForDoc("d", 5) });

describe("page operations", () => {
  it("rotates, deletes and moves pages without touching others", () => {
    const s = base();
    const [p0, p1, p2] = s.pages;
    const r = rotatePages(s, new Set([p1.id]), -90);
    expect(r.pages[1].rotation).toBe(270);
    expect(r.pages[0]).toBe(p0); // structural sharing
    const m = movePages(s, new Set([p2.id]), 0);
    expect(m.pages.map((p) => p.srcIndex)).toEqual([2, 0, 1, 3, 4]);
    const d = deletePages(s, new Set([p0.id]));
    expect(d.pages).toHaveLength(4);
  });

  it("never deletes the last page and drops annotations of deleted pages", () => {
    const s = base();
    const all = new Set(s.pages.map((p) => p.id));
    expect(deletePages(s, all)).toBe(s);
    const a: Annotation = { id: "a", pageId: s.pages[0].id, type: "note", x: 1, y: 1, text: "hi", color: "#ff0" };
    const d = deletePages(addAnnotation(s, a), new Set([s.pages[0].id]));
    expect(d.annotations).toHaveLength(0);
  });
});

describe("History", () => {
  it("undoes and redoes, tracks dirty state", () => {
    const h = new History(base());
    expect(h.dirty).toBe(false);
    const s1 = rotatePages(h.state, new Set([h.state.pages[0].id]), 90);
    h.push(s1);
    expect(h.dirty).toBe(true);
    h.undo();
    expect(h.dirty).toBe(false);
    h.redo();
    expect(h.state).toBe(s1);
    h.markSaved();
    expect(h.dirty).toBe(false);
  });
});

describe("annotations", () => {
  it("translates any kind", () => {
    const ink: Annotation = { id: "i", pageId: "p", type: "ink", points: [0, 0, 10, 10], color: "#000", width: 1, opacity: 1 };
    expect((translateAnnotation(ink, 5, -5) as typeof ink).points).toEqual([5, -5, 15, 5]);
  });

  it("simplifies dense pen strokes", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 1000; i++) pts.push(i, 0.01 * Math.sin(i));
    const out = simplifyPoints(pts, 0.5);
    expect(out.length).toBeLessThan(10);
    expect(out.slice(0, 2)).toEqual([0, 0]);
  });
});
