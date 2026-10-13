import { describe, expect, it, vi } from "vitest";
import { fileKeyOf, fileVersionOf, SourceRangeTransport, type PdfSource } from "../../src/core/source";
import { Marks } from "../../src/edit/marks";

const source = (over: Partial<PdfSource>): PdfSource => ({
  name: "scan.pdf",
  size: 1000,
  freshReadAll: true,
  readRange: async () => new Uint8Array(0),
  readAll: async () => new Uint8Array(0),
  ...over,
});

describe("file identity", () => {
  it("uses the path on desktop, so saving (new size) keeps the same key", () => {
    const before = source({ path: "C:\\Docs\\Scan.pdf", size: 1000, modified: 1 });
    const after = source({ path: "c:\\docs\\scan.pdf", size: 2345, modified: 2 });
    expect(fileKeyOf(before)).toBe(fileKeyOf(after));
    expect(fileVersionOf(before)).not.toBe(fileVersionOf(after));
  });

  it("tells apart two same-name, same-size files without a path", () => {
    expect(fileKeyOf(source({ modified: 1 }))).not.toBe(fileKeyOf(source({ modified: 2 })));
  });
});

describe("range reads", () => {
  it("retries a failed read, reports the problem, and recovers", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const t = new SourceRangeTransport(
      source({
        readRange: async () => {
          if (++calls <= 2) throw new Error("offline");
          return new Uint8Array([1, 2, 3]);
        },
      }),
    );
    const events: (string | null)[] = [];
    t.onReadProblem = (err) => events.push(err ? (err as Error).message : null);
    const got: number[] = [];
    t.onDataRange = (begin: number) => void got.push(begin);
    t.requestDataRange(512, 515);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(events).toEqual(["offline", "offline", null]);
    expect(got).toEqual([512]);
  });

  it("stops retrying once the document is closed", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const t = new SourceRangeTransport(
      source({
        readRange: async () => {
          calls++;
          throw new Error("gone");
        },
      }),
    );
    t.requestDataRange(0, 10);
    await vi.advanceTimersByTimeAsync(600);
    t.abort();
    const before = calls;
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    expect(calls).toBe(before);
  });
});

describe("marks after saving", () => {
  it("follow their pages to the new numbers, and pages that were deleted lose theirs", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const m = new Marks();
    m.load("path:c:\\a.pdf", "a.pdf:1000");
    m.add(0, 0.1, "intro");
    m.add(5, 0.5, "chapter");
    m.add(9, 0.2, "deleted later");
    // Saved with page 6 (index 5) moved to the front and page 10 deleted.
    const moved = new Map([[5, 0], [0, 1]]);
    m.remap((i) => moved.get(i));
    expect(m.all.map((x) => [x.label, x.srcIndex])).toEqual([
      ["chapter", 0],
      ["intro", 1],
    ]);
    // Marks stored under the old "name:size" key are moved over once.
    store.set("pdfstudio:marks:b.pdf:10", JSON.stringify([{ id: "x", label: "old", srcIndex: 2, fy: 0, color: "#000", created: 0 }]));
    m.load("path:c:\\b.pdf", "b.pdf:10");
    expect(m.all.map((x) => x.label)).toEqual(["old"]);
    expect(store.has("pdfstudio:marks:b.pdf:10")).toBe(false);
    vi.unstubAllGlobals();
  });
});
