import type { FormValue } from "../edit/model";

/**
 * Form data in and out: a CSV with the field names in the first row and the
 * values in the second (opens in Excel; several filled forms can be pasted
 * as more rows), or a JSON object { name: value }.
 */
export interface FieldInfo {
  name: string;
  /** PDF.js field type: text, checkbox, radiobutton, combobox, listbox... */
  type: string;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function valueText(v: FormValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "Off";
  return Array.isArray(v) ? v.join("; ") : v;
}

export function toCsv(fields: FieldInfo[], value: (name: string) => FormValue | undefined): string {
  const head = fields.map((f) => csvCell(f.name)).join(",");
  const row = fields.map((f) => csvCell(valueText(value(f.name)))).join(",");
  return "﻿" + head + "\r\n" + row + "\r\n"; // BOM: Excel reads Thai correctly
}

/** RFC 4180 rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x !== ""));
}

/** name -> value, from a CSV (first data row) or JSON file. */
export function parseFormData(text: string): Record<string, string | boolean> {
  const t = text.trim();
  if (t.startsWith("{")) {
    const o = JSON.parse(t) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v ?? "")]));
  }
  const [head, values] = parseCsv(text);
  if (!head || !values) throw new Error("The file needs field names in the first row and values in the second.");
  return Object.fromEntries(head.map((h, i) => [h.trim(), values[i] ?? ""]));
}

/** A value from a file, as the edit model stores it for that kind of field. */
export function formValueFor(type: string, v: string | boolean): FormValue {
  if (type === "checkbox") return typeof v === "boolean" ? v : /^(yes|true|1|on|x|✓|✔)$/i.test(v.trim());
  if (type === "listbox") return typeof v === "string" ? v.split(";").map((x) => x.trim()).filter(Boolean) : [];
  return typeof v === "boolean" ? (v ? "Yes" : "") : v;
}
