import { buttons, modal, title } from "../ui/dialogs";
import { DEFAULT_LABEL_OPTIONS, STOCK_SIZES, type LabelOptions, type LabelPreset } from "./labels";

const KEY = "pdfstudio:labels";

/** Last used label settings (remembered per device). */
export function loadLabelOptions(): LabelOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_LABEL_OPTIONS, ...saved };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_LABEL_OPTIONS };
}

function saveLabelOptions(o: LabelOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

const PRESETS: { value: LabelPreset; label: string; hint: string }[] = [
  { value: "shopee", label: "Shopee: one label per half page", hint: "Empty halves are skipped." },
  { value: "lazada", label: "Lazada: label at the top left of each page", hint: "Keeps the top-left part; the rest of the page is dropped." },
  { value: "grid", label: "Grid: several labels per page", hint: "Cells with nothing on them are skipped." },
  { value: "page", label: "Whole page: each page is one label", hint: "" },
];

/**
 * Label printing dialog. Resolves with the chosen action and options, or
 * null when cancelled. Options are remembered for next time.
 */
export function labelDialog(): Promise<{ action: "print" | "save"; options: LabelOptions } | null> {
  const o = loadLabelOptions();
  return new Promise((resolve) => {
    modal((box, close) => {
      box.classList.add("label-dialog");
      title(box, "Print labels", "Cuts each shipping label out and puts it on its own label-sized page, ready for a label printer.");

      const field = (labelText: string, control: HTMLElement) => {
        const row = document.createElement("label");
        row.className = "form-row";
        const span = document.createElement("span");
        span.textContent = labelText;
        row.append(span, control);
        box.appendChild(row);
        return row;
      };
      const select = (options: { value: string; label: string }[], value: string) => {
        const s = document.createElement("select");
        for (const opt of options) s.add(new Option(opt.label, opt.value, false, opt.value === value));
        return s;
      };
      const num = (value: number, min: number, max: number, step = 1) => {
        const i = document.createElement("input");
        i.type = "number";
        i.className = "num-input";
        Object.assign(i, { min: String(min), max: String(max), step: String(step), value: String(value) });
        return i;
      };

      const preset = select(PRESETS, o.preset);
      field("Layout", preset);
      const hint = document.createElement("p");
      hint.className = "muted small";
      box.appendChild(hint);

      const rows = num(o.rows ?? 2, 1, 10);
      const cols = num(o.cols ?? 2, 1, 10);
      const gridBox = document.createElement("span");
      gridBox.className = "inline-fields";
      gridBox.append(rows, document.createTextNode(" rows × "), cols, document.createTextNode(" columns"));
      const gridRow = field("Grid", gridBox);

      const stockKey = (w: number, h: number) => `${w}x${h}`;
      const known = STOCK_SIZES.some((s) => stockKey(s.width, s.height) === stockKey(o.stockMm.width, o.stockMm.height));
      const stock = select(
        [...STOCK_SIZES.map((s) => ({ value: stockKey(s.width, s.height), label: s.name })), { value: "custom", label: "Custom size…" }],
        known ? stockKey(o.stockMm.width, o.stockMm.height) : "custom",
      );
      field("Label stock", stock);
      const cw = num(o.stockMm.width, 10, 400, 0.1);
      const ch = num(o.stockMm.height, 10, 400, 0.1);
      const customBox = document.createElement("span");
      customBox.className = "inline-fields";
      customBox.append(cw, document.createTextNode(" × "), ch, document.createTextNode(" mm"));
      const customRow = field("Size", customBox);

      const check = (text: string, checked: boolean, tip: string) => {
        const l = document.createElement("label");
        l.className = "check form-check";
        l.title = tip;
        const c = document.createElement("input");
        c.type = "checkbox";
        c.checked = checked;
        l.append(c, document.createTextNode(" " + text));
        box.appendChild(l);
        return c;
      };
      const crisp = check("Sharp barcodes (redrawn on the printer's dot grid)", o.crispBarcodes ?? true, "Barcodes scan more reliably on thermal printers.");
      const big = check("Larger Shopee order number (SPX labels)", o.bigOrderNumber ?? true, "Easier to read when packing.");
      const dpi = num(o.printerDpi ?? 203, 100, 1200);
      field("Printer resolution (dpi)", dpi).title = "TSC TTP-244 Pro: 203 dpi";

      const sync = () => {
        const p = preset.value as LabelPreset;
        hint.textContent = PRESETS.find((x) => x.value === p)!.hint;
        gridRow.hidden = p !== "grid";
        customRow.hidden = stock.value !== "custom";
        big.parentElement!.hidden = p !== "shopee";
      };
      preset.addEventListener("change", sync);
      stock.addEventListener("change", sync);
      sync();

      const read = (): LabelOptions => {
        const [w, h] =
          stock.value === "custom" ? [Number(cw.value), Number(ch.value)] : stock.value.split("x").map(Number);
        const opts: LabelOptions = {
          ...o,
          preset: preset.value as LabelPreset,
          stockMm: { width: w > 0 ? w : 82.6, height: h > 0 ? h : 49.8 },
          rows: Math.max(1, Math.round(Number(rows.value)) || 2),
          cols: Math.max(1, Math.round(Number(cols.value)) || 2),
          crispBarcodes: crisp.checked,
          bigOrderNumber: big.checked,
          printerDpi: Math.max(72, Math.round(Number(dpi.value)) || 203),
        };
        saveLabelOptions(opts);
        return opts;
      };
      const done = (v: { action: "print" | "save"; options: LabelOptions } | null) => {
        close();
        resolve(v);
      };
      box.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") done(null);
      });
      const [, , printBtn] = buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        { label: "Save label PDF", onClick: () => done({ action: "save", options: read() }) },
        { label: "Print labels", primary: true, onClick: () => done({ action: "print", options: read() }) },
      ]);
      requestAnimationFrame(() => printBtn.focus());
    });
  });
}
