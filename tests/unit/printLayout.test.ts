import { describe, expect, it } from "vitest";
import { choosePages, planSheets } from "../../src/print/layout";

const portrait = () => false;

describe("print layout", () => {
  it("odd / even / reverse count the chosen pages", () => {
    const p = [0, 1, 2, 3, 4];
    expect(choosePages(p, "odd", false)).toEqual([0, 2, 4]);
    expect(choosePages(p, "even", true)).toEqual([3, 1]);
  });

  it("puts 4 pages per upright sheet, 2 per sideways sheet", () => {
    const four = planSheets([0, 1, 2, 3, 4], 4, portrait);
    expect(four.map((s) => s.cells)).toEqual([[0, 1, 2, 3], [4, null, null, null]]);
    expect(four[0]).toMatchObject({ cols: 2, rows: 2, landscape: false });
    expect(planSheets([0, 1], 2, portrait)[0]).toMatchObject({ cols: 2, rows: 1, landscape: true });
    expect(planSheets([0, 1, 2, 3, 4, 5], 6, portrait)[0]).toMatchObject({ cols: 2, rows: 3 });
  });

  it("one per sheet follows each page's orientation unless fixed", () => {
    const land = (i: number) => i === 1;
    expect(planSheets([0, 1], 1, land).map((s) => s.landscape)).toEqual([false, true]);
    expect(planSheets([0, 1], 1, land, "portrait").map((s) => s.landscape)).toEqual([false, false]);
  });

  it("booklet: 8 pages fold into 2 sheets that read in order", () => {
    const b = planSheets([0, 1, 2, 3, 4, 5, 6, 7], "booklet", portrait).map((s) => s.cells);
    // sheet 1 front, back; sheet 2 front, back
    expect(b).toEqual([[7, 0], [1, 6], [5, 2], [3, 4]]);
    // 5 pages pad to 8 with blanks
    expect(planSheets([0, 1, 2, 3, 4], "booklet", portrait).flatMap((s) => s.cells).filter((c) => c === null)).toHaveLength(3);
  });
});
