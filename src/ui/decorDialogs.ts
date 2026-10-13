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

export type PageChoice = "current" | "selected" | "all";

function pageChoice(box: HTMLElement, selected: number, total: number, value: PageChoice): HTMLSelectElement {
  const opts: [string, string][] = [["current", "Current page"]];
  if (selected > 1) opts.push(["selected", `Selected pages (${selected})`]);
  opts.push(["all", `All pages (${total})`]);
  const s = select(opts, opts.some(([v]) => v === value) ? value : "current");
  row(box, "Pages", s);
  return s;
}

const IMG_KEY = "pdfstudio:export-images";

export function exportImagesDialog(selected: number, total: number): Promise<{ pages: PageChoice; format: "png" | "jpeg"; dpi: number } | null> {
  const o = remember(IMG_KEY, { pages: "current" as PageChoice, format: "png" as "png" | "jpeg", dpi: 150 });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Export pages as images", "Each page becomes a picture file, ready for Shopee, Lazada or LINE.");
      const pages = pageChoice(box, selected, total, o.pages);
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
      const done = (v: { pages: PageChoice; format: "png" | "jpeg"; dpi: number } | null) => {
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
          onClick: () => done({ pages: pages.value as PageChoice, format: format.value as "png" | "jpeg", dpi: Number(dpi.value) }),
        },
      ]);
    });
  });
}

const SPLIT_KEY = "pdfstudio:split";

/** How to split the document into files; `parts` validates and returns the page groups. */
export function splitDialog(total: number, parts: (how: { every: number } | { ranges: string }) => number[][]): Promise<number[][] | null> {
  const o = remember(SPLIT_KEY, { mode: "every", every: 1, ranges: "" });
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Split into files", `This document has ${total} pages. Each part is saved as its own PDF.`);
      const mode = select(
        [
          ["every", "Every N pages"],
          ["ranges", "By page ranges"],
        ],
        o.mode,
      );
      row(box, "Split", mode);
      const every = num(o.every, 1, Math.max(1, total));
      const everyRow = row(box, "Pages per file", every);
      const ranges = document.createElement("input");
      ranges.className = "modal-input";
      ranges.placeholder = "e.g. 1-3, 4-10, 11-";
      ranges.value = o.ranges;
      const rangesRow = row(box, "Ranges", ranges);
      const info = document.createElement("p");
      info.className = "muted small";
      box.appendChild(info);
      let result: number[][] | null = null;
      const how = () => (mode.value === "every" ? { every: Number(every.value) || 1 } : { ranges: ranges.value });
      const sync = () => {
        everyRow.hidden = mode.value !== "every";
        rangesRow.hidden = mode.value !== "ranges";
        try {
          result = parts(how());
          info.textContent = `${result.length} file${result.length === 1 ? "" : "s"}: ${result
            .slice(0, 6)
            .map((p) => (p.length === 1 ? `${p[0] + 1}` : `${p[0] + 1}-${p[p.length - 1] + 1}`))
            .join(", ")}${result.length > 6 ? ", …" : ""}`;
          info.classList.remove("error-text");
        } catch (e) {
          result = null;
          info.textContent = (e as Error).message;
          info.classList.add("error-text");
        }
      };
      for (const el of [mode, every, ranges]) el.addEventListener("input", sync);
      sync();
      const done = (v: number[][] | null) => {
        store(SPLIT_KEY, { mode: mode.value, every: Number(every.value) || 1, ranges: ranges.value });
        close();
        resolve(v);
      };
      escClose(box, () => done(null));
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        { label: "Split", primary: true, onClick: () => (result ? done(result) : ranges.focus()) },
      ]);
    });
  });
}
