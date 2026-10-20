import { DEFAULT_PAGE_NUMBERS, PAGE_NUMBER_FORMATS, type PageNumberOptions, type Position } from "../edit/pageDecor";
import {
  BUILTIN_STAMPS,
  dataUrlToBlob,
  deleteStamp,
  removeWhiteBackground,
  renderTextStamp,
  savedStamps,
  saveStamp,
  shrinkToPng,
  type TextStamp,
} from "../edit/stamps";
import { buttons, modal, promptText, title, toast } from "./dialogs";
import { parsePages } from "../save/split";
import { PAPER, type Layout, type Subset } from "../print/layout";
import { pageLabel, type PageLabelRule, type PageLabelStyle } from "../edit/model";

/** Dialogs for stamps, page numbers and watermarks. Choices are remembered. */

function remember<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v === "object" ? { ...fallback, ...v } : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function row(box: HTMLElement, label: string, control: HTMLElement): HTMLLabelElement {
  const r = document.createElement("label");
  r.className = "form-row";
  const s = document.createElement("span");
  s.textContent = label;
  r.append(s, control);
  box.appendChild(r);
  return r;
}
function select(options: [string, string][], value: string): HTMLSelectElement {
  const s = document.createElement("select");
  for (const [v, l] of options) s.add(new Option(l, v, false, v === value));
  return s;
}
function check(box: HTMLElement, text: string, checked: boolean): HTMLInputElement {
  const l = document.createElement("label");
  l.className = "check form-check";
  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = checked;
  l.append(c, document.createTextNode(" " + text));
  box.appendChild(l);
  return c;
}
function num(value: number, min: number, max: number): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "number";
  i.className = "num-input";
  Object.assign(i, { min: String(min), max: String(max), value: String(value) });
  return i;
}
function escClose(box: HTMLElement, done: () => void): void {
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") done();
  });
}

const POSITIONS: [Position, string][] = [
  ["bottom-center", "Bottom center"],
  ["bottom-right", "Bottom right"],
  ["bottom-left", "Bottom left"],
  ["top-center", "Top center"],
  ["top-right", "Top right"],
  ["top-left", "Top left"],
];

// ------------------------------------------------------------------ stamps

export interface StampChoice {
  png: Blob;
  allPages: boolean;
}

const STAMP_KEY = "pdfstudio:stamp-dialog";

/** Pick a stamp: built-in text stamps, custom text, or the user's saved seals/images. */
export function stampDialog(pickImage: () => Promise<File | null>): Promise<StampChoice | null> {
  const prefs = remember(STAMP_KEY, { withDate: false, allPages: false, clearWhite: true });
  return new Promise((resolve) => {
    const urls: string[] = [];
    let finish = (_v: StampChoice | null) => {};
    const close = modal((box, closeModal) => {
      box.classList.add("stamp-dialog");
      title(box, "Stamp", "Click a stamp to place it, then drag it where you want. Add your company seal once and reuse it.");
      const grid = document.createElement("div");
      grid.className = "stamp-grid";
      box.appendChild(grid);
      const withDate = check(box, "Add today's date under text stamps", prefs.withDate);
      const allPages = check(box, "Put it on every page (bottom right)", prefs.allPages);
      const clearWhite = check(box, "Seal/logo images: make the white background transparent", prefs.clearWhite);

      finish = (v) => {
        store(STAMP_KEY, { withDate: withDate.checked, allPages: allPages.checked, clearWhite: clearWhite.checked });
        closeModal();
        urls.forEach((u) => URL.revokeObjectURL(u));
        resolve(v);
      };
      const tile = (label: string, preview: string | null, onPick: () => Promise<Blob | null>, onDelete?: () => void) => {
        const t = document.createElement("button");
        t.className = "stamp-tile";
        t.title = label;
        if (preview) {
          const img = document.createElement("img");
          img.src = preview;
          img.alt = label;
          t.appendChild(img);
        } else {
          t.textContent = label;
          t.classList.add("stamp-add");
        }
        t.addEventListener("click", async () => {
          const png = await onPick();
          if (png) finish({ png, allPages: allPages.checked });
        });
        if (onDelete) {
          const x = document.createElement("span");
          x.className = "stamp-del";
          x.textContent = "×";
          x.title = "Remove this saved stamp";
          x.addEventListener("click", (e) => {
            e.stopPropagation();
            onDelete();
            t.remove();
          });
          t.appendChild(x);
        }
        grid.appendChild(t);
      };
      const textTile = (s: TextStamp) => {
        const t = document.createElement("button");
        t.className = "stamp-tile stamp-text";
        t.textContent = s.text;
        t.style.color = s.color;
        t.style.borderColor = s.color;
        t.addEventListener("click", async () => finish({ png: await renderTextStamp(s, withDate.checked), allPages: allPages.checked }));
        grid.appendChild(t);
      };
      for (const s of savedStamps()) tile(s.name, s.dataUrl, () => dataUrlToBlob(s.dataUrl), () => deleteStamp(s.id));
      for (const s of BUILTIN_STAMPS) textTile(s);
      tile("+ Custom text…", null, async () => {
        const text = await promptText("Stamp text", "", { placeholder: "e.g. ชำระแล้ว / CHECKED", okLabel: "Use" });
        return text?.trim() ? renderTextStamp({ text: text.trim(), color: "#1d4ed8" }, withDate.checked) : null;
      });
      tile("+ Add seal / logo image…", null, async () => {
        const file = await pickImage();
        if (!file) return null;
        try {
          const png = clearWhite.checked ? await removeWhiteBackground(file) : await shrinkToPng(file);
          const name = file.name.replace(/\.[^.]+$/, "");
          try {
            await saveStamp(name, png);
          } catch {
            toast("Stamp placed, but not saved for next time (storage full).", "info", 5000);
          }
          return png;
        } catch {
          toast("This image format isn't supported.", "error");
          return null;
        }
      });
      escClose(box, () => finish(null));
      buttons(box, [{ label: "Cancel", onClick: () => finish(null) }]);
    });
    void close;
  });
}

// ------------------------------------------------------------------ page numbers

const PN_KEY = "pdfstudio:page-numbers";

export function pageNumbersDialog(hasNumbers: boolean): Promise<PageNumberOptions | "remove" | null> {
  const o = remember<PageNumberOptions>(PN_KEY, DEFAULT_PAGE_NUMBERS);
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Page numbers", "Added to every page as text you can still move or delete. Running this again replaces them.");
      const fmt = select(
        PAGE_NUMBER_FORMATS.map((f) => [f, f.replace("{n}", "1").replace("{total}", "12")]),
        o.format,
      );
      row(box, "Format", fmt);
      const pos = select(POSITIONS, o.position);
      row(box, "Position", pos);
      const size = num(o.fontSize, 6, 36);
      row(box, "Size (pt)", size);
      const start = num(o.start, 0, 99999);
      row(box, "First number", start);
      const skip = check(box, "No number on the first page (cover)", o.skipFirst);
      const done = (v: PageNumberOptions | "remove" | null) => {
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      const defs = [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Add page numbers",
          primary: true,
          onClick: () => {
            const v: PageNumberOptions = {
              ...o,
              format: fmt.value,
              position: pos.value as Position,
              fontSize: Math.min(36, Math.max(6, Number(size.value) || 10)),
              start: Math.max(0, Math.round(Number(start.value)) || 1),
              skipFirst: skip.checked,
            };
            store(PN_KEY, v);
            done(v);
          },
        },
      ];
      if (hasNumbers) defs.splice(1, 0, { label: "Remove page numbers", onClick: () => done("remove") });
      buttons(box, defs);
    });
  });
}

// ------------------------------------------------------------------ watermark

export interface WatermarkOptions {
  text: string;
  color: string;
  opacity: number;
}
const WM_KEY = "pdfstudio:watermark";

export function watermarkDialog(hasWatermark: boolean): Promise<WatermarkOptions | "remove" | null> {
  const o = remember<WatermarkOptions>(WM_KEY, { text: "CONFIDENTIAL", color: "#dc2626", opacity: 0.15 });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Watermark", "Faint diagonal text across every page. Running this again replaces it.");
      const text = document.createElement("input");
      text.className = "modal-input";
      text.value = o.text;
      text.placeholder = "e.g. CONFIDENTIAL / สำเนา / ห้ามเผยแพร่";
      row(box, "Text", text);
      const color = select(
        [
          ["#dc2626", "Red"],
          ["#1d4ed8", "Blue"],
          ["#6b7280", "Grey"],
          ["#000000", "Black"],
          ["#15803d", "Green"],
        ],
        o.color,
      );
      row(box, "Colour", color);
      const strength = select(
        [
          ["0.08", "Very light"],
          ["0.15", "Light"],
          ["0.25", "Medium"],
          ["0.4", "Strong"],
        ],
        String(o.opacity),
      );
      row(box, "Strength", strength);
      const done = (v: WatermarkOptions | "remove" | null) => {
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      const defs = [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Add watermark",
          primary: true,
          onClick: () => {
            if (!text.value.trim()) return text.focus();
            const v = { text: text.value.trim(), color: color.value, opacity: Number(strength.value) || 0.15 };
            store(WM_KEY, v);
            done(v);
          },
        },
      ];
      if (hasWatermark) defs.splice(1, 0, { label: "Remove watermark", onClick: () => done("remove") });
      buttons(box, defs);
      requestAnimationFrame(() => text.select());
    });
  });
}

// ------------------------------------------------------------------ export images / split into files

export type PageChoice = "current" | "selected" | "all" | "range";

/**
 * Which pages: current, selected, all, or typed ranges ("1-3, 7, 10-").
 * `count()` is how many pages that is, or null while the ranges are invalid.
 */
function pageChoice(box: HTMLElement, selected: number, total: number, value: PageChoice, ranges: string) {
  const opts: [string, string][] = [["current", "Current page"]];
  if (selected > 1) opts.push(["selected", `Selected pages (${selected})`]);
  opts.push(["all", `All pages (${total})`], ["range", "Page range…"]);
  const s = select(opts, opts.some(([v]) => v === value) ? value : "current");
  row(box, "Pages", s);
  const input = document.createElement("input");
  input.className = "modal-input";
  input.placeholder = "e.g. 1-3, 7, 10-";
  input.value = ranges;
  const rangeRow = row(box, "Page range", input);
  const err = document.createElement("p");
  err.className = "small error-text";
  box.appendChild(err);
  const count = (): number | null => {
    if (s.value === "all") return total;
    if (s.value === "selected") return selected;
    if (s.value === "current") return 1;
    try {
      return parsePages(total, input.value).length;
    } catch {
      return null;
    }
  };
  const sync = () => {
    rangeRow.hidden = s.value !== "range";
    err.hidden = true;
    if (s.value === "range" && input.value.trim()) {
      try {
        parsePages(total, input.value);
      } catch (e) {
        err.textContent = (e as Error).message;
        err.hidden = false;
      }
    }
  };
  s.addEventListener("change", () => {
    sync();
    if (s.value === "range") input.focus();
  });
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => e.stopPropagation());
  sync();
  return {
    select: s,
    input,
    count,
    /** The choice, or null (and the range box focused) if the typed ranges are invalid. */
    value(): { pages: PageChoice; ranges: string } | null {
      if (s.value === "range" && count() === null) {
        sync();
        if (!input.value.trim()) {
          err.textContent = "Type the pages, e.g. 1-3, 7, 10-";
          err.hidden = false;
        }
        input.focus();
        return null;
      }
      return { pages: s.value as PageChoice, ranges: input.value };
    },
  };
}

const IMG_KEY = "pdfstudio:export-images";

export interface ExportImagesChoice {
  pages: PageChoice;
  ranges: string;
  format: "png" | "jpeg";
  dpi: number;
}

export function exportImagesDialog(selected: number, total: number): Promise<ExportImagesChoice | null> {
  const o = remember(IMG_KEY, { pages: "current" as PageChoice, ranges: "", format: "png" as "png" | "jpeg", dpi: 150 });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Export pages as images", "Each page becomes a picture file, ready for Shopee, Lazada or LINE.");
      const pages = pageChoice(box, selected, total, o.pages, o.ranges);
      const format = select(
        [
          ["png", "PNG (sharp text, transparent-free)"],
          ["jpeg", "JPG (smaller files, photos)"],
        ],
        o.format,
      );
      row(box, "Format", format);
      const dpi = select(
        [
          ["96", "Screen (96 dpi)"],
          ["150", "Good (150 dpi)"],
          ["300", "Print (300 dpi)"],
        ],
        String(o.dpi),
      );
      row(box, "Quality", dpi);
      const done = (v: ExportImagesChoice | null) => {
        if (v) store(IMG_KEY, v);
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Export",
          primary: true,
          onClick: () => {
            const p = pages.value();
            if (p) done({ ...p, format: format.value as "png" | "jpeg", dpi: Number(dpi.value) });
          },
        },
      ]);
    });
  });
}

const SPLIT_KEY = "pdfstudio:split";

export type ExtractMode = "one" | "ranges" | "every";

/** What to make: the page groups, and whether they go into one PDF or one file each. */
export interface ExtractChoice {
  parts: number[][];
  oneFile: boolean;
}

/**
 * Extract / split pages, one dialog for both:
 *   - "one":    the pages you list, together in one new PDF
 *   - "ranges": each range you list as its own PDF
 *   - "every":  every N pages as its own PDF
 * `start` is the mode to open in; `pages` prefills the page box (e.g. the selection).
 */
export function extractDialog(
  total: number,
  start: { mode?: ExtractMode; pages?: string },
  parts: (how: { every: number } | { ranges: string }) => number[][],
): Promise<ExtractChoice | null> {
  const o = remember(SPLIT_KEY, { mode: "one" as ExtractMode, every: 1, ranges: "" });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Extract / split pages", `This document has ${total} pages. The original file isn't changed.`);
      const mode = select(
        [
          ["one", "Chosen pages → one new PDF"],
          ["ranges", "Each range → its own PDF"],
          ["every", "Every N pages → its own PDF"],
        ],
        start.mode ?? o.mode,
      );
      row(box, "Make", mode);
      const every = num(o.every, 1, Math.max(1, total));
      const everyRow = row(box, "Pages per file", every);
      const ranges = document.createElement("input");
      ranges.className = "modal-input";
      ranges.value = start.pages ?? o.ranges;
      ranges.addEventListener("keydown", (e) => e.stopPropagation());
      const rangesRow = row(box, "Pages", ranges);
      const info = document.createElement("p");
      info.className = "muted small";
      box.appendChild(info);
      let result: number[][] | null = null;
      const how = () => (mode.value === "every" ? { every: Number(every.value) || 1 } : { ranges: ranges.value });
      const label = (p: number[]) => (p.length === 1 ? `${p[0] + 1}` : `${p[0] + 1}-${p[p.length - 1] + 1}`);
      const sync = () => {
        everyRow.hidden = mode.value !== "every";
        rangesRow.hidden = mode.value === "every";
        ranges.placeholder = mode.value === "one" ? "e.g. 1-3, 7, 10-" : "e.g. 1-3, 4-10, 11-";
        try {
          result = parts(how());
          if (mode.value === "one") {
            const n = new Set(result.flat()).size;
            info.textContent = `1 file with ${n} page${n === 1 ? "" : "s"}.`;
          } else {
            info.textContent = `${result.length} file${result.length === 1 ? "" : "s"}: ${result.slice(0, 6).map(label).join(", ")}${result.length > 6 ? ", …" : ""}`;
          }
          info.classList.remove("error-text");
        } catch (e) {
          result = null;
          info.textContent = (e as Error).message;
          info.classList.add("error-text");
        }
      };
      for (const el of [mode, every, ranges]) el.addEventListener("input", sync);
      mode.addEventListener("change", sync);
      sync();
      const done = (v: ExtractChoice | null) => {
        store(SPLIT_KEY, { mode: mode.value, every: Number(every.value) || 1, ranges: ranges.value });
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Save…",
          primary: true,
          onClick: () => {
            if (!result) return ranges.focus();
            if (mode.value === "one") done({ parts: [[...new Set(result.flat())]], oneFile: true });
            else done({ parts: result, oneFile: false });
          },
        },
      ]);
      requestAnimationFrame(() => (mode.value === "every" ? every : ranges).focus());
    });
  });
}

// ------------------------------------------------------------------ merge PDFs

/** Put the chosen files in order (and drop any) before merging. Returns the order as indices. */
export function mergeDialog(names: string[]): Promise<number[] | null> {
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Merge PDFs", "The files are joined in this order into one new PDF. The originals aren't changed.");
      const order = names.map((_, i) => i);
      const list = document.createElement("ol");
      list.className = "merge-list";
      box.appendChild(list);
      const info = document.createElement("p");
      info.className = "muted small";
      box.appendChild(info);
      const small = (label: string, icon: string, onClick: () => void, disabled: boolean) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "icon-btn small";
        b.title = label;
        b.setAttribute("aria-label", label);
        b.textContent = icon;
        b.disabled = disabled;
        b.addEventListener("click", onClick);
        return b;
      };
      const render = () => {
        list.replaceChildren(
          ...order.map((fi, k) => {
            const li = document.createElement("li");
            const name = document.createElement("span");
            name.className = "merge-name";
            name.textContent = names[fi];
            li.append(
              name,
              small("Move up", "↑", () => (order.splice(k - 1, 0, ...order.splice(k, 1)), render()), k === 0),
              small("Move down", "↓", () => (order.splice(k + 1, 0, ...order.splice(k, 1)), render()), k === order.length - 1),
              small("Remove", "✕", () => (order.splice(k, 1), render()), false),
            );
            return li;
          }),
        );
        info.textContent = order.length < 2 ? "Choose at least two files to merge." : `${order.length} files → 1 PDF.`;
      };
      render();
      const done = (v: number[] | null) => {
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        { label: "Merge", primary: true, onClick: () => order.length >= 2 && done(order.slice()) },
      ]);
    });
  });
}

// ------------------------------------------------------------------ cut pages

const CUT_KEY = "pdfstudio:cut";

export interface CutChoice {
  pages: PageChoice;
  ranges: string;
  /** Fractions 0..1 (x from the left, y from the top), or undefined for no cut. */
  x?: number;
  y?: number;
}

/**
 * Cut pages into pieces: a vertical and/or a horizontal cut, each at a
 * percentage, with a live preview on the current page.
 */
export function cutDialog(selected: number, total: number, preview: (canvas: HTMLCanvasElement) => Promise<void>): Promise<CutChoice | null> {
  const o = remember(CUT_KEY, { pages: "current" as PageChoice, ranges: "", vOn: true, v: 50, hOn: false, h: 50 });
  return new Promise((resolve) => {
    modal((box, close) => {
      box.classList.add("cut-dialog");
      title(box, "Cut pages", "Each page is cut into pieces and every piece becomes its own page, e.g. a 2-up scan or an A3 spread into A4 pages.");
      const pages = pageChoice(box, selected, total, o.pages, o.ranges);

      const stage = document.createElement("div");
      stage.className = "cut-stage";
      const canvas = document.createElement("canvas");
      const vLine = document.createElement("div");
      vLine.className = "cut-line cut-v";
      const hLine = document.createElement("div");
      hLine.className = "cut-line cut-h";
      stage.append(canvas, vLine, hLine);
      box.appendChild(stage);
      void preview(canvas).catch(() => {});

      const control = (label: string, on: boolean, value: number) => {
        const r = document.createElement("div");
        r.className = "form-row cut-row";
        const c = document.createElement("label");
        c.className = "check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = on;
        c.append(cb, document.createTextNode(" " + label));
        const range = document.createElement("input");
        range.type = "range";
        Object.assign(range, { min: "5", max: "95", step: "0.5", value: String(value) });
        const n = num(value, 5, 95);
        n.step = "0.5";
        const pct = document.createElement("span");
        pct.textContent = "%";
        r.append(c, range, n, pct);
        box.appendChild(r);
        range.addEventListener("input", () => ((n.value = range.value), sync()));
        n.addEventListener("input", () => ((range.value = n.value), sync()));
        cb.addEventListener("change", sync);
        return { cb, range, n };
      };
      const v = control("Vertical cut at", o.vOn, o.v);
      const h = control("Horizontal cut at", o.hOn, o.h);
      const info = document.createElement("p");
      info.className = "muted small";
      box.appendChild(info);
      const clamp = (x: string) => Math.min(95, Math.max(5, Number(x) || 50));

      function sync() {
        const vx = clamp(v.n.value),
          hy = clamp(h.n.value);
        vLine.hidden = !v.cb.checked;
        hLine.hidden = !h.cb.checked;
        vLine.style.left = `${vx}%`;
        hLine.style.top = `${hy}%`;
        const pieces = (v.cb.checked ? 2 : 1) * (h.cb.checked ? 2 : 1);
        const n = pages.count() ?? 0;
        info.textContent =
          pieces < 2 ? "Turn on at least one cut." : n === 0 ? "Type the pages to cut, e.g. 1-3, 7." : `${n} page${n === 1 ? "" : "s"} → ${n * pieces} pages (${pieces} pieces each). Undo (Ctrl+Z) puts them back.`;
      }
      pages.select.addEventListener("change", sync);
      pages.input.addEventListener("input", sync);
      sync();

      const done = (val: CutChoice | null) => {
        store(CUT_KEY, { pages: pages.select.value, ranges: pages.input.value, vOn: v.cb.checked, v: clamp(v.n.value), hOn: h.cb.checked, h: clamp(h.n.value) });
        close();
        resolve(val);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Cut",
          primary: true,
          onClick: () => {
            if (!v.cb.checked && !h.cb.checked) return;
            const p = pages.value();
            if (!p) return;
            done({
              ...p,
              x: v.cb.checked ? clamp(v.n.value) / 100 : undefined,
              y: h.cb.checked ? clamp(h.n.value) / 100 : undefined,
            });
          },
        },
      ]);
    });
  });
}

// ------------------------------------------------------------------ password

/** Choose a password (typed twice) and what is allowed without the owner password. */
export function protectDialog(): Promise<import("../save/encrypt").Protection | null> {
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Protect with a password", "Saves a copy that asks for this password when opened (AES-256, works in Adobe Reader, Edge, Chrome and phones). Don't forget it: it can't be recovered.");
      const field = (label: string) => {
        const i = document.createElement("input");
        i.type = "password";
        i.className = "modal-input";
        i.autocomplete = "new-password";
        row(box, label, i);
        return i;
      };
      const p1 = field("Password");
      const p2 = field("Type it again");
      const show = check(box, "Show password", false);
      show.addEventListener("change", () => (p1.type = p2.type = show.checked ? "text" : "password"));
      const print = check(box, "Allow printing", true);
      const copy = check(box, "Allow copying text", true);
      const edit = check(box, "Allow changes", true);
      const msg = document.createElement("p");
      msg.className = "small error-text";
      box.appendChild(msg);
      const done = (v: import("../save/encrypt").Protection | null) => {
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Save protected copy",
          primary: true,
          onClick: () => {
            if (p1.value.length < 4) return void ((msg.textContent = "Use at least 4 characters."), p1.focus());
            if (p1.value !== p2.value) return void ((msg.textContent = "The two passwords are different."), p2.focus());
            done({ userPassword: p1.value, allowPrint: print.checked, allowCopy: copy.checked, allowEdit: edit.checked });
          },
        },
      ]);
      requestAnimationFrame(() => p1.focus());
    });
  });
}

// ------------------------------------------------------------------ PDF from photos

const PHOTOS_KEY = "pdfstudio:photos";

export function photosDialog(count: number): Promise<{ trim: boolean; scanLook: boolean } | null> {
  const o = remember(PHOTOS_KEY, { trim: true, scanLook: false });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Make a PDF from photos", `${count} picture${count === 1 ? "" : "s"}, one per A4 page, in the order chosen.`);
      const trim = check(box, "Trim empty borders around each picture", o.trim);
      const scan = check(box, "Scan look: clean black & white (receipts, documents)", o.scanLook);
      const done = (v: { trim: boolean; scanLook: boolean } | null) => {
        if (v) store(PHOTOS_KEY, v);
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        { label: "Make PDF", primary: true, onClick: () => done({ trim: trim.checked, scanLook: scan.checked }) },
      ]);
    });
  });
}

// ------------------------------------------------------------------ shrink

export function shrinkDialog(sizeMb: number): Promise<"small" | "balanced" | "high" | null> {
  const o = remember("pdfstudio:shrink", { level: "balanced" });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Shrink PDF size", `This file is ${sizeMb.toFixed(1)} MB. Pictures are re-compressed; text stays sharp. A smaller copy is saved; the original is kept.`);
      const level = select(
        [
          ["small", "Smallest (for LINE / email)"],
          ["balanced", "Balanced"],
          ["high", "High quality (for printing)"],
        ],
        o.level,
      );
      row(box, "Size", level);
      const done = (v: "small" | "balanced" | "high" | null) => {
        if (v) store("pdfstudio:shrink", { level: v });
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        { label: "Shrink", primary: true, onClick: () => done(level.value as "small" | "balanced" | "high") },
      ]);
    });
  });
}

// ------------------------------------------------------------------ settings

export interface SettingsValues {
  language: "en" | "th" | "zh";
  viewMode: "continuous" | "single" | "spread";
  night: boolean;
  readRate: number;
  render: "auto" | "gpu" | "cpu";
  /** What Automatic picked on this PC. */
  detected?: "gpu" | "cpu";
}

export function settingsDialog(v: SettingsValues): Promise<(SettingsValues & { reset: boolean }) | null> {
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Settings");
      const language = select(
        [
          ["en", "English"],
          ["th", "ไทย (Thai)"],
          ["zh", "中文 (Chinese)"],
        ],
        v.language,
      );
      row(box, "Language", language);
      const view = select(
        [
          ["continuous", "Scroll"],
          ["single", "One page"],
          ["spread", "Two pages"],
        ],
        v.viewMode,
      );
      row(box, "Page layout", view);
      const night = check(box, "Night reading (dark pages)", v.night);
      const rate = select(
        [
          ["0.8", "0.8×"],
          ["1", "1×"],
          ["1.25", "1.25×"],
          ["1.5", "1.5×"],
        ],
        String(v.readRate),
      );
      row(box, "Reading speed", rate);
      const render = select(
        [
          ["auto", `Automatic (this PC: ${v.detected === "cpu" ? "processor" : "graphics card"})`],
          ["gpu", "Graphics card (GPU)"],
          ["cpu", "Processor (CPU)"],
        ],
        v.render,
      );
      row(box, "Rendering", render).title = "Graphics card: smoother, less CPU. Processor: if pages look wrong or the app is unstable on this PC.";
      let reset = false;
      const done = (ok: boolean) => {
        close();
        resolve(
          ok
            ? {
                language: language.value as SettingsValues["language"],
                viewMode: view.value as SettingsValues["viewMode"],
                night: night.checked,
                readRate: Number(rate.value) || 1,
                render: render.value as "auto" | "gpu" | "cpu",
                reset,
              }
            : null,
        );
      };
      escClose(box, () => done(false));
      buttons(box, [
        { label: "Reset remembered choices", onClick: () => ((reset = true), done(true)) },
        { label: "Close", primary: true, onClick: () => done(true) },
      ]);
    });
  });
}

// ------------------------------------------------------------------ OCR

const OCR_KEY = "pdfstudio:ocr";

export function ocrDialog(selected: number, total: number): Promise<{ pages: PageChoice; ranges: string; langs: ("tha" | "eng" | "chi_sim")[]; skipText: boolean } | null> {
  const o = remember(OCR_KEY, { pages: "all" as PageChoice, ranges: "", tha: true, eng: true, chi_sim: false, skipText: true });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Recognize text (OCR)", "Makes scanned pages searchable and copyable, offline. A searchable copy opens in a new tab; the pages look the same.");
      const pages = pageChoice(box, selected, total, o.pages, o.ranges);
      const tha = check(box, "Thai", o.tha);
      const eng = check(box, "English", o.eng);
      const chi = check(box, "Chinese (simplified)", o.chi_sim);
      const skip = check(box, "Skip pages that already have text", o.skipText);
      const msg = document.createElement("p");
      msg.className = "small error-text";
      box.appendChild(msg);
      const done = (v: { pages: PageChoice; ranges: string; langs: ("tha" | "eng" | "chi_sim")[]; skipText: boolean } | null) => {
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Recognize",
          primary: true,
          onClick: () => {
            const langs = [tha.checked && "tha", eng.checked && "eng", chi.checked && "chi_sim"].filter(Boolean) as ("tha" | "eng" | "chi_sim")[];
            if (!langs.length) return void (msg.textContent = "Choose at least one language.");
            const p = pages.value();
            if (!p) return;
            store(OCR_KEY, { ...p, tha: tha.checked, eng: eng.checked, chi_sim: chi.checked, skipText: skip.checked });
            done({ ...p, langs, skipText: skip.checked });
          },
        },
      ]);
    });
  });
}

// ------------------------------------------------------------------ help

const SHORTCUTS: [string, string][] = [
  ["Ctrl+K", "Find a command"],
  ["Ctrl+O", "Open"],
  ["Ctrl+S / Ctrl+Shift+S", "Save / Save as"],
  ["Ctrl+P", "Print"],
  ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
  ["Ctrl+F, Enter / Shift+Enter", "Find, next / previous"],
  ["Ctrl+Shift+F", "Search a folder of PDFs"],
  ["Ctrl+= / Ctrl+- / Ctrl+0", "Zoom in / out / fit width"],
  ["Ctrl+\\", "Split view"],
  ["M or Ctrl+D", "Mark this position"],
  ["Home / End", "First / last page"],
  ["V H U T P R O L A N", "Select, pan, highlight, text, draw, box, circle, line, arrow, comment"],
  ["Del", "Delete the selected annotation"],
];

export function shortcutsDialog(): void {
  modal((box, close) => {
    title(box, "Keyboard shortcuts");
    const table = document.createElement("table");
    table.className = "shortcuts";
    for (const [k, v] of SHORTCUTS) {
      const tr = document.createElement("tr");
      const a = document.createElement("td");
      const kbd = document.createElement("kbd");
      kbd.textContent = k;
      a.appendChild(kbd);
      const b = document.createElement("td");
      b.textContent = v;
      tr.append(a, b);
      table.appendChild(tr);
    }
    box.appendChild(table);
    escClose(box, close);
    buttons(box, [{ label: "Close", primary: true, onClick: close }]);
  });
}

const CREDITS: [string, string, string][] = [
  ["PDF.js", "Mozilla", "Apache-2.0"],
  ["pdf-lib", "Andrew Dillon", "MIT"],
  ["Tesseract OCR / tesseract.js", "Google, Tesseract contributors", "Apache-2.0"],
  ["Tauri", "Tauri Programme", "MIT / Apache-2.0"],
  ["Yjs", "Kevin Jahns", "MIT"],
  ["docx", "Dolan Miu", "MIT"],
  ["fflate", "Arjun Barrett", "MIT"],
  ["jsQR / qrcode", "Cosmo Wolfe; Ryan Day", "Apache-2.0; MIT"],
  ["node-forge", "Digital Bazaar", "BSD-3-Clause"],
  ["Compact ICC Profiles (sRGB)", "Clinton Ingram", "CC0"],
];

export async function aboutDialog(): Promise<void> {
  let version = "";
  try {
    if ("__TAURI_INTERNALS__" in window) version = await (await import("@tauri-apps/api/app")).getVersion();
  } catch {
    /* browser build */
  }
  modal((box, close) => {
    title(box, "PDF Studio", `${version ? `Version ${version}. ` : ""}A fast, stable PDF viewer and editor for Windows and iOS: Thai, Chinese and English.`);
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "Built by tul018 with help from Claude (Anthropic) and ChatGPT (OpenAI). It uses these open-source projects:";
    box.appendChild(p);
    const table = document.createElement("table");
    table.className = "shortcuts";
    for (const [name, by, lic] of CREDITS) {
      const tr = document.createElement("tr");
      for (const t of [name, by, lic]) {
        const td = document.createElement("td");
        td.textContent = t;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    box.appendChild(table);
    escClose(box, close);
    buttons(box, [{ label: "Close", primary: true, onClick: close }]);
  });
}

// ------------------------------------------------------------------ print

const PRINT_KEY = "pdfstudio:print";

export interface PrintChoice {
  pages: PageChoice;
  ranges: string;
  subset: Subset;
  reverse: boolean;
  layout: Layout;
  /** "auto" = each page's own size (one per sheet), A4 otherwise. */
  paper: string;
  orientation: "auto" | "portrait" | "landscape";
  gray: boolean;
}

/**
 * Print: which pages, how many per sheet (or a booklet), paper, grayscale,
 * with a live preview of each sheet. The printer, copies and two-sided
 * printing are chosen in the system print dialog that opens next.
 */
export function printDialog(
  selected: number,
  total: number,
  preview: (c: PrintChoice, sheet: number) => Promise<{ canvas: HTMLCanvasElement | null; sheets: number }>,
): Promise<PrintChoice | null> {
  const o = remember<PrintChoice>(PRINT_KEY, {
    pages: "all",
    ranges: "",
    subset: "all",
    reverse: false,
    layout: 1,
    paper: "auto",
    orientation: "auto",
    gray: false,
  });
  return new Promise((resolve) => {
    modal((box, close) => {
      box.classList.add("print-dialog");
      title(box, "Print");
      const grid = document.createElement("div");
      grid.className = "print-grid";
      const form = document.createElement("div");
      const side = document.createElement("div");
      side.className = "print-preview";
      grid.append(form, side);
      box.append(grid);

      const pages = pageChoice(form, selected, total, o.pages, o.ranges);
      const subset = select(
        [
          ["all", "All of them"],
          ["odd", "Odd pages only"],
          ["even", "Even pages only"],
        ],
        o.subset,
      );
      row(form, "Print", subset);
      const layout = select(
        [
          ["1", "1 page per sheet"],
          ["2", "2 pages per sheet"],
          ["4", "4 pages per sheet"],
          ["6", "6 pages per sheet"],
          ["booklet", "Booklet (fold in half)"],
        ],
        String(o.layout),
      );
      row(form, "Layout", layout);
      const paper = select([["auto", "Same as the pages"], ...Object.keys(PAPER).map((k): [string, string] => [k, k])], o.paper);
      row(form, "Paper", paper);
      const orient = select(
        [
          ["auto", "Automatic"],
          ["portrait", "Portrait"],
          ["landscape", "Landscape"],
        ],
        o.orientation,
      );
      const orientRow = row(form, "Orientation", orient);
      const reverse = check(form, "Reverse order", o.reverse);
      const gray = check(form, "Black and white (grayscale)", o.gray);
      const hint = document.createElement("p");
      hint.className = "muted small";
      form.append(hint);

      const frame = document.createElement("div");
      frame.className = "print-frame";
      const nav = document.createElement("div");
      nav.className = "print-nav";
      const prev = document.createElement("button");
      prev.className = "btn small";
      prev.textContent = "‹";
      prev.setAttribute("aria-label", "Previous sheet");
      const label = document.createElement("span");
      label.className = "small print-count";
      const next = document.createElement("button");
      next.className = "btn small";
      next.textContent = "›";
      next.setAttribute("aria-label", "Next sheet");
      nav.append(prev, label, next);
      side.append(frame, nav);

      const choice = (): PrintChoice | null => {
        const p = pages.value();
        if (!p) return null;
        return {
          ...p,
          subset: subset.value as Subset,
          reverse: reverse.checked,
          layout: layout.value === "booklet" ? "booklet" : (Number(layout.value) as Layout),
          paper: paper.value,
          orientation: orient.value as PrintChoice["orientation"],
          gray: gray.checked,
        };
      };
      let sheet = 0;
      let count = 0;
      let ticket = 0;
      let timer = 0;
      const refresh = () => {
        const booklet = layout.value === "booklet";
        orientRow.hidden = booklet;
        hint.textContent = booklet
          ? "Print on both sides, flipping on the short edge, then fold the stack in half."
          : paper.value === "auto" && layout.value !== "1"
            ? "Several pages per sheet are printed on A4 unless you choose a paper size."
            : "";
        clearTimeout(timer);
        timer = window.setTimeout(async () => {
          const c = choice();
          if (!c) return;
          const mine = ++ticket;
          const res = await preview(c, sheet).catch(() => ({ canvas: null, sheets: 0 }));
          if (mine !== ticket) return;
          count = res.sheets;
          if (sheet >= count && count) {
            sheet = count - 1;
            return refresh();
          }
          frame.replaceChildren(...(res.canvas ? [res.canvas] : []));
          label.textContent = count ? `Sheet ${sheet + 1} of ${count}` : "Nothing to print";
          prev.disabled = sheet <= 0;
          next.disabled = sheet >= count - 1;
        }, 120);
      };
      prev.addEventListener("click", () => {
        if (sheet > 0) (sheet--, refresh());
      });
      next.addEventListener("click", () => {
        if (sheet < count - 1) (sheet++, refresh());
      });
      for (const el of [pages.select, subset, layout, paper, orient, reverse, gray]) el.addEventListener("change", () => ((sheet = 0), refresh()));
      pages.input.addEventListener("input", () => ((sheet = 0), refresh()));

      const done = (v: PrintChoice | null) => {
        if (v) store(PRINT_KEY, v);
        clearTimeout(timer);
        ticket++;
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        {
          label: "Print…",
          primary: true,
          onClick: () => {
            const c = choice();
            if (c && count) done(c);
          },
        },
      ]);
      refresh();
      requestAnimationFrame(() => pages.select.focus());
    });
  });
}

// ------------------------------------------------------------ page labels

const LABEL_STYLES: [PageLabelStyle, string][] = [
  ["D", "1, 2, 3"],
  ["r", "i, ii, iii"],
  ["R", "I, II, III"],
  ["a", "a, b, c"],
  ["A", "A, B, C"],
  ["", "No number (prefix only)"],
];

/**
 * Page labels: from a page on, number pages in a style with a prefix (e.g.
 * front pages i, ii, iii, then 1, 2, 3 from the first chapter). Saved in the
 * PDF, so other apps show the same page numbers.
 */
export function pageLabelsDialog(total: number, initial: readonly PageLabelRule[], current: number): Promise<PageLabelRule[] | null> {
  return new Promise((resolve) => {
    modal((box, close) => {
      box.classList.add("labels-dialog");
      title(box, "Page labels", "Number pages your way, e.g. i, ii, iii for the front pages, then 1, 2, 3.");
      const list = document.createElement("div");
      list.className = "label-rules";
      const preview = document.createElement("p");
      preview.className = "muted small label-preview";
      box.append(list);
      const rows: (() => PageLabelRule | null)[] = [];
      const update = () => {
        const rules = collect();
        const shown = Array.from({ length: Math.min(total, 8) }, (_, i) => `${i + 1}→${pageLabel(rules, i) ?? i + 1}`);
        preview.textContent = rules.length ? `${shown.join("  ")}${total > 8 ? "  …" : ""}` : "Plain page numbers (1, 2, 3…).";
      };
      const addRow = (r: PageLabelRule) => {
        const line = document.createElement("div");
        line.className = "label-rule";
        const from = num(r.start + 1, 1, total);
        const style = select(LABEL_STYLES, r.style);
        const prefix = document.createElement("input");
        prefix.className = "modal-input";
        prefix.placeholder = "Prefix";
        prefix.value = r.prefix;
        const first = num(r.first, 1, 99999);
        const del = document.createElement("button");
        del.className = "btn small";
        del.textContent = "×";
        del.setAttribute("aria-label", "Remove this numbering");
        const cell = (label: string, el: HTMLElement) => {
          const l = document.createElement("label");
          l.className = "small";
          l.append(label, el);
          return l;
        };
        line.append(cell("From page", from), cell("Style", style), cell("Prefix", prefix), cell("Start at", first), del);
        list.append(line);
        let removed = false;
        const get = (): PageLabelRule | null =>
          !removed
            ? { start: Math.min(total, Math.max(1, Math.round(Number(from.value) || 1))) - 1, style: style.value as PageLabelStyle, prefix: prefix.value, first: Math.max(1, Math.round(Number(first.value) || 1)) }
            : null;
        rows.push(get);
        for (const el of [from, style, prefix, first]) el.addEventListener("input", update);
        style.addEventListener("change", update);
        prefix.addEventListener("keydown", (e) => e.stopPropagation());
        del.addEventListener("click", () => {
          removed = true;
          line.remove();
          update();
        });
      };
      const collect = (): PageLabelRule[] => {
        const byStart = new Map<number, PageLabelRule>();
        for (const g of rows) {
          const r = g();
          if (r) byStart.set(r.start, r);
        }
        return [...byStart.values()].sort((a, b) => a.start - b.start);
      };
      for (const r of initial) addRow(r);
      if (!initial.length) {
        addRow({ start: 0, style: "r", prefix: "", first: 1 });
        if (current > 0) addRow({ start: current, style: "D", prefix: "", first: 1 });
      }
      const add = document.createElement("button");
      add.className = "btn small";
      add.textContent = `+ Numbering from page ${current + 1}`;
      add.addEventListener("click", () => {
        addRow({ start: current, style: "D", prefix: "", first: 1 });
        update();
      });
      box.append(add, preview);
      const done = (v: PageLabelRule[] | null) => {
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Plain numbers", onClick: () => done([]) },
        { label: "Cancel", onClick: () => done(null) },
        { label: "Apply", primary: true, onClick: () => done(collect()) },
      ]);
      update();
    });
  });
}
