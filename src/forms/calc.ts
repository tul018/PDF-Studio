/**
 * Form calculations without running the PDF's JavaScript: the formulas Acrobat
 * writes for its own Calculate tab are recognised and evaluated here.
 *   - AFSimple_Calculate("SUM" | "PRD" | "AVG" | "MIN" | "MAX", ["a", "b"])
 *   - Simplified field notation: price * qty + (tax - 1) / 2
 *   - Display: AFNumber_Format(decimals, separator style, ...) and AFPercent_Format
 * Anything else (custom scripts) is left alone. Nothing here executes code.
 */
export type Calc =
  | { kind: "simple"; op: "SUM" | "PRD" | "AVG" | "MIN" | "MAX"; fields: string[] }
  | { kind: "sfn"; expr: Expr };

type Expr = { n: number } | { f: string } | { op: "+" | "-" | "*" | "/"; a: Expr; b: Expr } | { neg: Expr };

export interface NumberFormat {
  decimals: number;
  /** 0: 1,234.56  1: 1234.56  2: 1.234,56  3: 1234,56 */
  sep: number;
  currency: string;
  prepend: boolean;
  percent: boolean;
}

export interface FormScripts {
  /** Calculated fields in calculation order. */
  order: string[];
  calc: Map<string, Calc>;
  format: Map<string, NumberFormat>;
}

const SIMPLE = /AFSimple_Calculate\s*\(\s*["'](SUM|PRD|AVG|MIN|MAX)["']\s*,\s*(?:new\s+Array\s*\(([^)]*)\)|\[([^\]]*)\])/;
const SFN = /\/\*\*\s*BVCALC\s+([\s\S]*?)\s+EVCALC\s*\*\*\//;

export function parseCalc(js: string): Calc | null {
  const m = SIMPLE.exec(js);
  if (m) {
    const list = (m[2] ?? m[3] ?? "").match(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g) ?? [];
    return { kind: "simple", op: m[1] as "SUM", fields: list.map((q) => q.slice(1, -1).replace(/\\(.)/g, "$1")) };
  }
  const s = SFN.exec(js);
  if (s) {
    try {
      return { kind: "sfn", expr: parseSfn(s[1]) };
    } catch {
      return null;
    }
  }
  return null;
}

export function parseFormat(js: string): NumberFormat | null {
  const num = /AFNumber_Format\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*["']((?:[^"'\\]|\\.)*)["']\s*,\s*(true|false)/.exec(js);
  if (num) return { decimals: +num[1], sep: +num[2], currency: num[3].replace(/\\(.)/g, "$1"), prepend: num[4] === "true", percent: false };
  const pct = /AFPercent_Format\s*\(\s*(\d+)\s*,\s*(\d+)/.exec(js);
  if (pct) return { decimals: +pct[1], sep: +pct[2], currency: "", prepend: false, percent: true };
  return null;
}

/**
 * Simplified field notation: numbers, field names (a backslash escapes
 * spaces and operators in names), + - * / and parentheses.
 */
function parseSfn(src: string): Expr {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const atom = (): Expr => {
    ws();
    if (src[i] === "(") {
      i++;
      const e = sum();
      ws();
      if (src[i++] !== ")") throw new Error("missing )");
      return e;
    }
    if (src[i] === "-") {
      i++;
      return { neg: atom() };
    }
    const num = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return { n: Number(num[0]) };
    }
    let name = "";
    while (i < src.length) {
      const c = src[i];
      if (c === "\\" && i + 1 < src.length) {
        name += src[i + 1];
        i += 2;
      } else if (/[\s+\-*/()]/.test(c)) break;
      else {
        name += c;
        i++;
      }
    }
    if (!name) throw new Error("expected a field");
    return { f: name };
  };
  const product = (): Expr => {
    let e = atom();
    for (ws(); src[i] === "*" || src[i] === "/"; ws()) {
      const op = src[i++] as "*" | "/";
      e = { op, a: e, b: atom() };
    }
    return e;
  };
  const sum = (): Expr => {
    let e = product();
    for (ws(); src[i] === "+" || src[i] === "-"; ws()) {
      const op = src[i++] as "+" | "-";
      e = { op, a: e, b: product() };
    }
    return e;
  };
  const e = sum();
  ws();
  if (i < src.length) throw new Error("unexpected " + src[i]);
  return e;
}

/** "1,234.50", "฿ 1.234,50", "15%" -> number (empty -> 0). */
export function toNumber(v: unknown, sep = 0): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  let s = v.replace(/[^\d.,\-]/g, "");
  if (sep >= 2) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function formatNumber(n: number, f: NumberFormat): string {
  const v = f.percent ? n * 100 : n;
  const [int, dec] = Math.abs(v).toFixed(f.decimals).split(".");
  const group = f.sep === 0 ? "," : f.sep === 2 ? "." : "";
  const point = f.sep >= 2 ? "," : ".";
  const grouped = group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, group) : int;
  let out = (v < 0 ? "-" : "") + grouped + (dec ? point + dec : "");
  if (f.percent) out += "%";
  if (f.currency) out = f.prepend ? f.currency + out : out + f.currency;
  return out;
}

function evalExpr(e: Expr, get: (name: string) => number): number {
  if ("n" in e) return e.n;
  if ("f" in e) return get(e.f);
  if ("neg" in e) return -evalExpr(e.neg, get);
  const a = evalExpr(e.a, get),
    b = evalExpr(e.b, get);
  return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : b === 0 ? 0 : a / b;
}

/**
 * New values for calculated fields, in calculation order (each sees the ones
 * before it). `get` returns a field's current value.
 */
export function calculate(scripts: FormScripts, get: (name: string) => unknown): Map<string, string> {
  const out = new Map<string, string>();
  const num = (name: string) => (out.has(name) ? toNumber(out.get(name), scripts.format.get(name)?.sep) : toNumber(get(name), scripts.format.get(name)?.sep));
  for (const name of scripts.order) {
    const c = scripts.calc.get(name);
    if (!c) continue;
    let v: number;
    if (c.kind === "sfn") v = evalExpr(c.expr, num);
    else {
      const xs = c.fields.map(num);
      v =
        c.op === "SUM" ? xs.reduce((a, b) => a + b, 0)
        : c.op === "PRD" ? xs.reduce((a, b) => a * b, 1)
        : c.op === "AVG" ? (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
        : c.op === "MIN" ? (xs.length ? Math.min(...xs) : 0)
        : xs.length ? Math.max(...xs) : 0;
    }
    if (!Number.isFinite(v)) v = 0;
    const f = scripts.format.get(name);
    out.set(name, f ? formatNumber(v, f) : String(Math.round(v * 1e6) / 1e6));
  }
  return out;
}
