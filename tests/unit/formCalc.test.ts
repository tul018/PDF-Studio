import { describe, expect, it } from "vitest";
import { calculate, formatNumber, parseCalc, parseFormat, toNumber, type FormScripts } from "../../src/forms/calc";

describe("form calculations", () => {
  it("reads Acrobat's sum and simplified notation", () => {
    expect(parseCalc('AFSimple_Calculate("SUM", new Array ("a", "b c"));')).toEqual({ kind: "simple", op: "SUM", fields: ["a", "b c"] });
    const sfn = parseCalc(String.raw`/** BVCALC price * qty + (tax\ rate - 1) / 2 EVCALC **/ event.value = 0`);
    expect(sfn?.kind).toBe("sfn");
    expect(parseCalc("event.value = Math.random()")).toBeNull();
  });

  it("calculates in order with number formats", () => {
    const vals: Record<string, string> = { price: "1,250.50", qty: "2", "tax rate": "3" };
    const scripts: FormScripts = {
      order: ["subtotal", "total"],
      calc: new Map([
        ["subtotal", parseCalc("/** BVCALC price * qty EVCALC **/")!],
        ["total", parseCalc('AFSimple_Calculate("SUM", ["subtotal", "tax rate"])')!],
      ]),
      format: new Map([["subtotal", parseFormat('AFNumber_Format(2, 0, 0, 0, "฿", true);')!]]),
    };
    const out = calculate(scripts, (n) => vals[n]);
    expect(out.get("subtotal")).toBe("฿2,501.00");
    expect(out.get("total")).toBe("2504");
  });

  it("formats and parses separators and percent", () => {
    expect(formatNumber(1234.5, { decimals: 2, sep: 2, currency: " €", prepend: false, percent: false })).toBe("1.234,50 €");
    expect(formatNumber(0.075, parseFormat("AFPercent_Format(1, 0);")!)).toBe("7.5%");
    expect(toNumber("1.234,50", 2)).toBe(1234.5);
  });
});
