import { describe, expect, it } from "vitest";
import { diffWords, words } from "../../src/compare/diff";

const d = (a: string, b: string) => {
  const r = diffWords(words(a), words(b));
  return { removed: r.removed.map((w) => w.text), added: r.added.map((w) => w.text) };
};

describe("compare: word differences", () => {
  it("finds changed, added and removed words", () => {
    expect(d("Price 1,200 baht, delivery in 7 days.", "Price 1,350 baht, delivery in 7 working days.")).toEqual({
      removed: ["1,200"],
      added: ["1,350", "working"],
    });
    expect(d("same text", "same text")).toEqual({ removed: [], added: [] });
  });
  it("Thai and Chinese are compared word by word, not as one long run", () => {
    const th = d("ราคาสินค้ารวมภาษีแล้ว", "ราคาสินค้าไม่รวมภาษี");
    expect(th.added).toContain("ไม่");
    expect(th.removed.join("")).toContain("แล้ว");
    const zh = d("交货时间七天", "交货时间十天");
    expect(zh.removed.length + zh.added.length).toBeGreaterThan(0);
    expect(zh.removed.join("")).not.toContain("交货");
  });
});
