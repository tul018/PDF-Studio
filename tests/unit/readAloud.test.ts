import { describe, expect, it } from "vitest";
import { chunks, langOf } from "../../src/viewer/readAloud";

describe("read aloud", () => {
  it("picks the language of each passage", () => {
    expect(langOf("สวัสดีครับ ราคา 250 บาท")).toBe("th");
    expect(langOf("散热器本田思域 2015")).toBe("zh");
    expect(langOf("Radiator for Honda Civic")).toBe("en");
  });
  it("cuts long text into short chunks at sentence ends, and long Thai runs at spaces", () => {
    const c = chunks("First sentence. Second one! " + "ก".repeat(500) + " ข", 200);
    expect(c[0]).toBe("First sentence. Second one!");
    expect(c.every((x) => x.length <= 200)).toBe(true);
    expect(c.join("").replace(/\s/g, "")).toContain("ข");
  });
});
