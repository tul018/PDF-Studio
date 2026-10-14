import { describe, expect, it } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
import { extractPageText } from "../../src/viewer/search";

function page(parts: Array<string | { str: string; hasEOL: boolean }>): PDFPageProxy {
  return { getTextContent: async () => ({ items: parts.map((part, i) => ({
    ...(typeof part === "string" ? { str: part } : part),
    transform: [12, 0, 0, 12, 20 + i * 10, 100], width: 10, height: 12,
  })) }) } as unknown as PDFPageProxy;
}

describe("search text extraction", () => {
  it("uses OCR space items once and preserves match offsets", async () => {
    const result = await extractPageText(page(["The", " ", "quick", " ", "brown"]));
    expect(result.text).toBe("The quick brown");
    expect(result.items[2 * 8]).toBe(4);
    expect(result.items[4 * 8]).toBe(10);
  });

  it("does not double spaces supplied inside adjacent fragments", async () => {
    expect((await extractPageText(page(["quick", " brown"]))).text).toBe("quick brown");
    expect((await extractPageText(page(["quick ", "brown"]))).text).toBe("quick brown");
  });

  it("normalizes line breaks so phrase queries match across lines", async () => {
    expect((await extractPageText(page(["quick", { str: "", hasEOL: true }, "brown"]))).text).toBe("quick brown");
    expect((await extractPageText(page([{ str: "quick", hasEOL: true }, "brown"]))).text).toBe("quick brown");
  });

  it("preserves unspaced scripts and synthesizes English word separators", async () => {
    expect((await extractPageText(page(["你", "好"]))).text).toBe("你好");
    expect((await extractPageText(page(["quick", "brown"]))).text).toBe("quick brown");
  });
});
