import type { AnnotationOverlay, HighlightMode, Tool, ToolOptions } from "../edit/overlay";
import { textFontCss, type Annotation, type TextFont } from "../edit/model";
import { canListAllFonts, installedFonts, loadAllFonts, loadFontsIfAllowed } from "./systemFonts";
import { fillOf, headsOf, shapePath, type HeadStyle, type ShapeSpec } from "../edit/shapes";

/**
 * The tool settings strip (only what the current tool or selection uses:
 * line thickness for drawing, font and size for text, opacity for
 * highlights) and the drop-down menus on the Highlight and Text tools.
 * Settings are shared by both split panes and remembered between sessions.
 */

const KEY = "pdfstudio:toolopts";
const LINE_TOOLS: Tool[] = ["ink", "rect", "ellipse", "shape", "line", "arrow"];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
const HL_COLORS = ["#ffeb3b", "#a5d6a7", "#81d4fa", "#f8bbd0", "#ffcc80"];
const TEXT_COLORS = ["#000000", "#e53935", "#1e63d6", "#2e7d32", "#6a1b9a"];
/** Standard PDF fonts: tiny files, look the same everywhere. */
const FONT_NAMES: [TextFont, string][] = [
  ["sans", "Sans (Helvetica)"],
  ["serif", "Serif (Times)"],
  ["mono", "Mono (Courier)"],
];
const fontLabel = (f: TextFont) => FONT_NAMES.find(([v]) => v === f)?.[1] ?? f;

/** "shape": box, circle and shapes, which have a fill as well as an outline. */
type Context = "" | "line" | "arrow" | "shape" | "text" | "hl";
const FILL_TOOLS: Tool[] = ["rect", "ellipse", "shape"];
const FILL_TYPES = ["rect", "ellipse", "shape", "cloud"];
const FILL_COLORS = ["#ffeb3b", "#ffcdd2", "#bbdefb", "#c8e6c9", "#e1bee7", "#ffffff", "#9e9e9e", "#000000"];

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

export class ToolOptionsUI {
  private pop: HTMLElement | null = null;
  private fontQuery = "";

  constructor(
    private overlays: () => AnnotationOverlay[],
    private tool: () => Tool,
    private setTool: (t: Tool) => void,
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ToolOptions> | null;
      if (saved && typeof saved === "object") Object.assign(this.opts, sanitize(saved));
    } catch {
      /* ignore */
    }
    this.bindStrip();
    this.fillFontSelect();
    void loadFontsIfAllowed().then(() => {
      this.fillFontSelect();
      this.sync();
    });
    document.querySelectorAll<HTMLElement>("[data-tool-menu]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = b.dataset.toolMenu as Tool;
        if (this.pop?.dataset.popTool === t) return this.closeMenu();
        // With one of its kind selected, the menu edits that one (switching tool would deselect it).
        const sel = this.selected()?.type;
        const edits = { shape: ["shape", "cloud"], arrow: ["arrow", "line"], highlight: ["highlight"], text: ["text"] } as Record<string, string[]>;
        if (this.tool() !== t && !(sel && edits[t]?.includes(sel))) this.setTool(t);
        this.openMenu(t, b);
      }),
    );
    document.addEventListener("pointerdown", (e) => {
      if (this.pop && !this.pop.contains(e.target as Node) && !(e.target as Element).closest?.("[data-tool-menu], [data-open-menu]")) this.closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.pop) {
        e.stopPropagation();
        this.closeMenu();
      }
    }, true);
    this.sync();
  }

  get opts(): ToolOptions {
    return this.overlays()[0].options;
  }

  private selected(): Annotation | null {
    for (const o of this.overlays()) if (o.selected) return o.selected;
    return null;
  }

  private context(): Context {
    const a = this.selected();
    if (a) {
      if (a.type === "highlight") return "hl";
      if (a.type === "text") return "text";
      if (FILL_TYPES.includes(a.type)) return "shape";
      if (a.type === "line" || a.type === "arrow") return "arrow";
      if (a.type === "ink") return "line";
      return "";
    }
    const t = this.tool();
    if (t === "highlight") return "hl";
    if (t === "text") return "text";
    if (FILL_TOOLS.includes(t)) return "shape";
    if (t === "arrow") return "arrow";
    return LINE_TOOLS.includes(t) ? "line" : "";
  }

  /** Change settings: they become the defaults for new marks and restyle the selected one. */
  set(patch: Partial<ToolOptions>): void {
    Object.assign(this.opts, patch);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.opts));
    } catch {
      /* ignore */
    }
    const style: Parameters<AnnotationOverlay["styleSelected"]>[0] = {};
    const sel = this.selected();
    if (patch.color !== undefined) style.color = patch.color;
    if (patch.highlightColor !== undefined && sel?.type === "highlight") style.color = patch.highlightColor;
    if (patch.highlightOpacity !== undefined) style.opacity = patch.highlightOpacity;
    if (patch.strokeWidth !== undefined) style.strokeWidth = patch.strokeWidth;
    if (patch.fontSize !== undefined) style.fontSize = patch.fontSize;
    if (patch.font !== undefined) style.font = patch.font;
    if (patch.shape) style.shape = patch.shape;
    if (patch.fillColor !== undefined) style.fillColor = patch.fillColor;
    if (patch.fillOpacity !== undefined) style.fillOpacity = patch.fillOpacity;
    if (patch.arrowStart) style.arrowStart = patch.arrowStart;
    if (patch.arrowEnd) style.arrowEnd = patch.arrowEnd;
    if (patch.arrowSize) style.arrowSize = patch.arrowSize;
    if (patch.lineOpacity !== undefined) style.lineOpacity = patch.lineOpacity;
    if (Object.keys(style).length) for (const o of this.overlays()) o.styleSelected(style);
    this.sync();
  }

  /** Show the settings that apply right now, with current values. */
  sync(): void {
    const ctx = this.context();
    document.body.dataset.opts = ctx;
    document.body.dataset.sel = this.selected()?.type ?? "";
    const a = this.selected();
    const o = this.opts;
    const color = $<HTMLInputElement>("#opt-color");
    const hl = ctx === "hl";
    const c = a && "color" in a ? a.color : hl ? o.highlightColor : o.color;
    color.value = c;
    color.parentElement!.title = hl ? "Highlight color" : "Color";
    const width = a && "width" in a ? a.width : a && a.type !== "highlight" && "strokeWidth" in a ? a.strokeWidth : o.strokeWidth;
    const wsel = $<HTMLSelectElement>("#opt-width");
    const none = wsel.querySelector('option[value="0"]');
    if (ctx === "shape" && !none) wsel.add(new Option("No outline", "0"), 0);
    if (ctx !== "shape" && none) none.remove();
    setSelect(wsel, String(width), `${width} pt`);
    const fl = a && FILL_TYPES.includes(a.type) ? fillOf(a as Parameters<typeof fillOf>[0]) : o.fillColor === "none" ? null : { color: o.fillColor, opacity: o.fillOpacity };
    $<HTMLInputElement>("#opt-fill-on").checked = !!fl;
    $<HTMLInputElement>("#opt-fill").value = fl?.color ?? (o.fillColor !== "none" ? o.fillColor : "#ffeb3b");
    const fop = Math.round((fl?.opacity ?? o.fillOpacity) * 100);
    $<HTMLInputElement>("#opt-fill-op").value = String(fop);
    $("#opt-fill-op-val").textContent = `${fop}%`;
    $(".opt-fill").classList.toggle("off", !fl);
    const [hs, he] = a && (a.type === "arrow" || a.type === "line") ? headsOf(a) : [o.arrowStart, o.arrowEnd];
    $<HTMLSelectElement>("#opt-head-start").value = hs;
    $<HTMLSelectElement>("#opt-head-end").value = he;
    const size = a && (a.type === "arrow" || a.type === "line") ? (a.headSize ?? 1) : o.arrowSize;
    setSelect($<HTMLSelectElement>("#opt-head-size"), String(size), `${Math.round(size * 100)}%`);
    const lop = Math.round((a && a.type !== "highlight" && "opacity" in a ? (a.opacity ?? 1) : a && (a.type === "line" || a.type === "arrow") ? (a.opacity ?? 1) : o.lineOpacity) * 100);
    $<HTMLInputElement>("#opt-line-op").value = String(lop);
    $("#opt-line-op-val").textContent = `${lop}%`;
    // Shape… only for the Shape tool or a selected shape / cloud.
    $(".opt-shapemenu").hidden = !(a ? a.type === "shape" || a.type === "cloud" : this.tool() === "shape");
    const font = (a?.type === "text" ? a.font : o.font) ?? "sans";
    setSelect($<HTMLSelectElement>("#opt-family"), font, fontLabel(font));
    if (document.activeElement !== $("#opt-font")) $<HTMLInputElement>("#opt-font").value = String(a?.type === "text" ? a.fontSize : o.fontSize);
    const op = a?.type === "highlight" ? a.opacity : o.highlightOpacity;
    $<HTMLInputElement>("#opt-opacity").value = String(Math.round(op * 100));
    $("#opt-opacity-val").textContent = `${Math.round(op * 100)}%`;
    if (this.pop) this.fillMenu(this.pop.dataset.popTool as Tool);
  }

  private bindStrip(): void {
    $<HTMLInputElement>("#opt-color").addEventListener("input", (e) => {
      const c = (e.target as HTMLInputElement).value;
      this.set(this.context() === "hl" ? { highlightColor: c } : { color: c });
    });
    $<HTMLSelectElement>("#opt-width").addEventListener("change", (e) => {
      this.set({ strokeWidth: parseFloat((e.target as HTMLSelectElement).value) });
    });
    $<HTMLSelectElement>("#opt-family").addEventListener("change", (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel.value === "__more") {
        sel.value = this.currentFont();
        return void this.loadAll();
      }
      this.set({ font: sel.value });
    });
    const size = $<HTMLInputElement>("#opt-font");
    const applySize = () => {
      const f = clampSize(parseFloat(size.value));
      if (f) this.set({ fontSize: f });
      else size.value = String(this.opts.fontSize);
    };
    size.addEventListener("change", applySize);
    size.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        applySize();
        size.blur();
      }
    });
    // Outline opacity: one undo step per slider drag.
    const lineOp = $<HTMLInputElement>("#opt-line-op");
    lineOp.addEventListener("input", () => ($("#opt-line-op-val").textContent = `${lineOp.value}%`));
    lineOp.addEventListener("change", () => {
      this.set({ lineOpacity: Number(lineOp.value) / 100 });
      lineOp.blur(); // shortcut keys work again
    });
    // Arrow heads and their size.
    $<HTMLSelectElement>("#opt-head-start").addEventListener("change", (e) => this.set({ arrowStart: (e.target as HTMLSelectElement).value as HeadStyle }));
    $<HTMLSelectElement>("#opt-head-end").addEventListener("change", (e) => this.set({ arrowEnd: (e.target as HTMLSelectElement).value as HeadStyle }));
    $<HTMLSelectElement>("#opt-head-size").addEventListener("change", (e) => this.set({ arrowSize: parseFloat((e.target as HTMLSelectElement).value) }));
    // Shape… opens the shape menu from the bar (edits the selected shape).
    $<HTMLElement>(".opt-shapemenu").addEventListener("click", (e) => {
      e.stopPropagation();
      const b = e.currentTarget as HTMLElement;
      if (this.pop?.dataset.popTool === "shape") return this.closeMenu();
      this.openMenu("shape", b);
    });
    // Fill of boxes, circles and shapes: on/off, colour, how solid.
    const fillOn = $<HTMLInputElement>("#opt-fill-on");
    const fillColor = $<HTMLInputElement>("#opt-fill");
    const fillOp = $<HTMLInputElement>("#opt-fill-op");
    fillOn.addEventListener("change", () => this.set({ fillColor: fillOn.checked ? fillColor.value : "none" }));
    fillColor.addEventListener("input", () => this.set({ fillColor: fillColor.value }));
    fillOp.addEventListener("input", () => ($("#opt-fill-op-val").textContent = `${fillOp.value}%`));
    fillOp.addEventListener("change", () => {
      this.set({ fillOpacity: Number(fillOp.value) / 100, ...(fillOn.checked ? {} : { fillColor: fillColor.value }) });
      fillOp.blur();
    });
    const opacity = $<HTMLInputElement>("#opt-opacity");
    opacity.addEventListener("input", () => {
      $("#opt-opacity-val").textContent = `${opacity.value}%`;
      this.opts.highlightOpacity = Number(opacity.value) / 100;
    });
    // One undo step per slider drag, not one per pixel.
    opacity.addEventListener("change", () => {
      this.set({ highlightOpacity: Number(opacity.value) / 100 });
      opacity.blur();
    });
  }

  // ------------------------------------------------------------ drop-downs

  private openMenu(t: Tool, anchor: HTMLElement): void {
    this.closeMenu();
    const pop = document.createElement("div");
    pop.className = "tool-pop";
    pop.dataset.popTool = t; // not data-tool: that would make clicks inside count as clicking the tool button
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", t === "highlight" ? "Highlight options" : t === "shape" ? "Shape options" : t === "arrow" ? "Arrow heads" : "Text options");
    document.body.appendChild(pop);
    this.pop = pop;
    anchor.setAttribute("aria-expanded", "true");
    this.fillMenu(t);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(r.left - 40, window.innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 4}px`;
  }

  closeMenu(): void {
    if (!this.pop) return;
    // A number being typed is applied, not lost, when the menu closes.
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && this.pop.contains(ae)) ae.blur();
    if (!this.pop) return;
    document.querySelector(`[data-tool-menu="${this.pop.dataset.popTool}"]`)?.setAttribute("aria-expanded", "false");
    this.pop.remove();
    this.pop = null;
  }

  private fillMenu(t: Tool): void {
    const pop = this.pop!;
    // Don't rebuild under the user's fingers (typing a size, dragging a slider).
    const ae = document.activeElement;
    if (ae instanceof HTMLInputElement && ae.type !== "color" && pop.contains(ae)) return;
    const o = this.opts;
    const a = this.selected();
    pop.replaceChildren();
    if (t === "shape") return this.shapeMenu(pop);
    if (t === "arrow") return this.arrowMenu(pop);
    if (t === "highlight") {
      const color = a?.type === "highlight" ? a.color : o.highlightColor;
      const op = a?.type === "highlight" ? a.opacity : o.highlightOpacity;
      pop.append(
        heading("Color"),
        swatches(HL_COLORS, color, (c) => this.set({ highlightColor: c })),
        heading("Opacity"),
        range(Math.round(op * 100), 10, 100, (v, done) => {
          if (done) this.set({ highlightOpacity: v / 100 });
          else o.highlightOpacity = v / 100;
        }),
        heading("Size"),
        choice<HighlightMode>(
          [
            ["free", "Free — drag any box"],
            ["fixed", "Fixed size — same height every time"],
          ],
          o.highlightMode,
          (m) => this.set({ highlightMode: m }),
        ),
      );
      const row = document.createElement("div");
      row.className = "pop-row";
      row.append(
        numberField("Width", o.highlightW, 4, 2000, (v) => this.set({ highlightW: v })),
        numberField("Height", o.highlightH, 2, 500, (v) => this.set({ highlightH: v })),
        unit("pt"),
      );
      row.classList.toggle("dim", o.highlightMode !== "fixed");
      pop.append(row, note("Fixed size: click to place a Width × Height highlight, or drag sideways to set the width — the height stays the same."));
    } else {
      const font = (a?.type === "text" ? a.font : o.font) ?? "sans";
      const size = a?.type === "text" ? a.fontSize : o.fontSize;
      const color = a?.type === "text" ? a.color : o.color;
      pop.append(heading("Font"), this.fontPicker(font), heading("Font size"));
      const grid = document.createElement("div");
      grid.className = "pop-sizes";
      for (const n of FONT_SIZES) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = String(n);
        b.classList.toggle("on", n === size);
        b.addEventListener("click", () => this.set({ fontSize: n }));
        grid.appendChild(b);
      }
      const row = document.createElement("div");
      row.className = "pop-row";
      row.append(numberField("Custom", size, 4, 400, (v) => this.set({ fontSize: v }), 0.5), unit("pt"));
      pop.append(grid, row, heading("Color"), swatches(TEXT_COLORS, color, (c) => this.set({ color: c })));
      pop.append(note("Tip: drag the corner handle of a text box to scale its size."));
    }
  }

  /** Shape tool: which outline, corners / points, star depth, fill. Applies to a selected shape too. */
  private shapeMenu(pop: HTMLElement): void {
    const a = this.selected();
    const spec: ShapeSpec = a?.type === "shape" && a.spec ? a.spec : this.opts.shape;
    const color = a && "color" in a ? a.color : this.opts.color;
    const fl = a && FILL_TYPES.includes(a.type) ? fillOf(a as Parameters<typeof fillOf>[0]) : this.opts.fillColor === "none" ? null : { color: this.opts.fillColor, opacity: this.opts.fillOpacity };
    const width = a && "strokeWidth" in a ? a.strokeWidth : this.opts.strokeWidth;
    const put = (p: Partial<ShapeSpec>) => this.set({ shape: { ...spec, ...p } });
    const grid = document.createElement("div");
    grid.className = "pop-shapes";
    const tile = (label: string, s: ShapeSpec, on: boolean) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "shape-tile";
      b.title = label;
      b.classList.toggle("on", on);
      b.innerHTML = `<svg viewBox="-2 -2 28 28" width="30" height="30"><g transform="translate(0,24) scale(1,-1)"><path d="${shapePath(s, 24, 24)}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></g></svg><span>${label}</span>`;
      b.addEventListener("click", () => this.set({ shape: s }));
      return b;
    };
    // Ready-made: triangle, diamond, pentagon, hexagon, octagon, stars, heart, cloud.
    const presets: [string, ShapeSpec][] = [
      ["Triangle", { kind: "polygon", sides: 3, inner: spec.inner }],
      ["Diamond", { kind: "polygon", sides: 4, inner: spec.inner }],
      ["Pentagon", { kind: "polygon", sides: 5, inner: spec.inner }],
      ["Hexagon", { kind: "polygon", sides: 6, inner: spec.inner }],
      ["Octagon", { kind: "polygon", sides: 8, inner: spec.inner }],
      ["Star", { kind: "star", sides: 5, inner: 0.45 }],
      ["Star 6", { kind: "star", sides: 6, inner: 0.55 }],
      ["Burst", { kind: "star", sides: 12, inner: 0.7 }],
      ["Heart", { kind: "heart", sides: spec.sides, inner: spec.inner }],
      ["Cloud", { kind: "cloud", sides: spec.sides, inner: spec.inner }],
    ];
    for (const [label, s] of presets) {
      const same = s.kind === spec.kind && (s.kind === "heart" || s.kind === "cloud" || (s.sides === spec.sides && (s.kind !== "star" || Math.abs(s.inner - spec.inner) < 0.01)));
      grid.append(tile(label, s, same));
    }
    pop.append(heading("Shape"), grid);
    if (spec.kind === "polygon" || spec.kind === "star") {
      const row = document.createElement("div");
      row.className = "pop-row";
      row.append(numberField(spec.kind === "star" ? "Points" : "Corners", spec.sides, 3, 12, (v) => put({ sides: Math.round(v) })));
      pop.append(row);
    }
    if (spec.kind === "star") {
      pop.append(
        heading("Point depth"),
        range(Math.round((1 - spec.inner) * 100), 10, 80, (v, done) => {
          if (done) put({ inner: 1 - v / 100 });
        }),
      );
    }
    const noFill = document.createElement("button");
    noFill.type = "button";
    noFill.className = "btn small pop-none";
    noFill.textContent = "No fill";
    noFill.classList.toggle("on", !fl);
    noFill.addEventListener("click", () => this.set({ fillColor: "none" }));
    const noLine = document.createElement("button");
    noLine.type = "button";
    noLine.className = "btn small pop-none";
    noLine.textContent = "No outline";
    noLine.classList.toggle("on", width === 0);
    noLine.addEventListener("click", () => this.set({ strokeWidth: 0 }));
    const fillSw = swatches(FILL_COLORS, fl?.color ?? "#ffffff", (c) => this.set({ fillColor: c }));
    if (!fl) fillSw.querySelectorAll(".swatch.on").forEach((s) => s.classList.remove("on"));
    fillSw.prepend(noFill);
    const lineSw = swatches(TEXT_COLORS, color, (c) => this.set({ color: c, ...(width === 0 ? { strokeWidth: 2 } : {}) }));
    if (width === 0) lineSw.querySelectorAll(".swatch.on").forEach((s) => s.classList.remove("on"));
    lineSw.prepend(noLine);
    pop.append(
      heading("Fill"),
      fillSw,
      range(Math.round((fl?.opacity ?? this.opts.fillOpacity) * 100), 10, 100, (v, done) => {
        if (done) this.set({ fillOpacity: v / 100, ...(fl ? {} : { fillColor: "#ffeb3b" }) });
      }),
      heading("Outline"),
      lineSw,
      range(Math.round(((a && "opacity" in a && a.type !== "highlight" ? a.opacity : this.opts.lineOpacity) ?? 1) * 100), 10, 100, (v, done) => {
        if (done) this.set({ lineOpacity: v / 100 });
      }),
      note("Select a shape to change its fill or outline later (also in the strip above)."),
    );
  }

  /** Arrow tool: the head at each end (both, one, or none). Applies to a selected arrow too. */
  private arrowMenu(pop: HTMLElement): void {
    const a = this.selected();
    const [start, end] = a && (a.type === "arrow" || a.type === "line") ? headsOf(a) : [this.opts.arrowStart, this.opts.arrowEnd];
    const heads: [HeadStyle, string][] = [
      ["none", "None"],
      ["open", "Open ›"],
      ["closed", "Filled ▶"],
      ["circle", "Dot ●"],
      ["bar", "Bar |"],
    ];
    const quick = document.createElement("div");
    quick.className = "pop-choice";
    const q = (label: string, s: HeadStyle, e: HeadStyle) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.classList.toggle("on", s === start && e === end);
      b.addEventListener("click", () => this.set({ arrowStart: s, arrowEnd: e }));
      quick.append(b);
    };
    q("→  One head", "none", "open");
    q("↔  Both heads", "open", "open");
    q("▶  Filled head", "none", "closed");
    q("—  No heads", "none", "none");
    pop.append(
      heading("Arrow"),
      quick,
      heading("Start"),
      choice<HeadStyle>(heads, start, (s) => this.set({ arrowStart: s }), true),
      heading("End"),
      choice<HeadStyle>(heads, end, (e) => this.set({ arrowEnd: e }), true),
    );
  }

  private currentFont(): TextFont {
    const a = this.selected();
    return (a?.type === "text" ? a.font : this.opts.font) ?? "sans";
  }

  /** Ask for the full list of installed fonts (Windows asks permission once). */
  private async loadAll(): Promise<void> {
    await loadAllFonts();
    this.fillFontSelect();
    this.sync();
  }

  /** The toolbar's font list: standard fonts, then the fonts on this computer. */
  private fillFontSelect(): void {
    const sel = $<HTMLSelectElement>("#opt-family");
    const std = document.createElement("optgroup");
    std.label = "Standard (smallest file)";
    for (const [v, l] of FONT_NAMES) std.appendChild(new Option(l, v));
    const mine = document.createElement("optgroup");
    mine.label = "On this computer";
    for (const f of installedFonts()) {
      const op = new Option(f, f);
      op.style.fontFamily = textFontCss({ font: f });
      mine.appendChild(op);
    }
    sel.replaceChildren(std, mine);
    if (canListAllFonts()) sel.appendChild(new Option("More fonts on this PC…", "__more"));
    sel.value = this.currentFont();
  }

  /** Searchable list of fonts, each shown in its own typeface. */
  private fontPicker(current: TextFont): HTMLElement {
    const box = document.createElement("div");
    box.className = "font-picker";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search fonts…";
    search.value = this.fontQuery;
    const list = document.createElement("div");
    list.className = "font-list";
    list.setAttribute("role", "listbox");
    const item = (value: TextFont, label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "font-item";
      b.textContent = label;
      b.dataset.value = value;
      b.setAttribute("role", "option");
      b.style.fontFamily = textFontCss({ font: value });
      const on = value === current;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
      b.addEventListener("click", () => this.set({ font: value }));
      return b;
    };
    const group = (label: string) => {
      const h = document.createElement("div");
      h.className = "font-group";
      h.textContent = label;
      return h;
    };
    list.append(group("Standard (smallest file)"), ...FONT_NAMES.map(([v, l]) => item(v, l)));
    list.append(group("On this computer"), ...installedFonts().map((f) => item(f, f)));
    const filter = () => {
      this.fontQuery = search.value;
      const q = search.value.trim().toLowerCase();
      list.querySelectorAll<HTMLElement>(".font-item").forEach((b) => (b.hidden = !!q && !b.textContent!.toLowerCase().includes(q)));
    };
    search.addEventListener("input", filter);
    search.addEventListener("keydown", (e) => e.stopPropagation());
    filter();
    box.append(search, list);
    if (canListAllFonts()) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "font-more";
      more.textContent = "Show all fonts on this PC…";
      more.addEventListener("click", () => void this.loadAll());
      box.appendChild(more);
    }
    // Keep the chosen font in view.
    requestAnimationFrame(() => list.querySelector<HTMLElement>(".font-item.on")?.scrollIntoView({ block: "nearest" }));
    return box;
  }
}

// ------------------------------------------------------------------ helpers

function clampSize(n: number): number | null {
  return Number.isFinite(n) && n >= 4 && n <= 400 ? Math.round(n * 2) / 2 : null;
}

function sanitize(s: Partial<ToolOptions>): Partial<ToolOptions> {
  const out: Partial<ToolOptions> = {};
  const hex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && v >= lo && v <= hi;
  if (hex(s.color)) out.color = s.color;
  if (hex(s.highlightColor)) out.highlightColor = s.highlightColor;
  if (num(s.strokeWidth, 0.25, 50)) out.strokeWidth = s.strokeWidth;
  if (num(s.fontSize, 4, 400)) out.fontSize = s.fontSize;
  if (num(s.highlightOpacity, 0.05, 1)) out.highlightOpacity = s.highlightOpacity;
  if (num(s.highlightW, 4, 2000)) out.highlightW = s.highlightW;
  if (num(s.highlightH, 2, 500)) out.highlightH = s.highlightH;
  if (s.highlightMode === "free" || s.highlightMode === "fixed") out.highlightMode = s.highlightMode;
  if (typeof s.font === "string" && s.font.length > 0 && s.font.length < 100) out.font = s.font;
  const heads = ["none", "open", "closed", "circle", "bar"];
  if (heads.includes(s.arrowStart as string)) out.arrowStart = s.arrowStart;
  if (heads.includes(s.arrowEnd as string)) out.arrowEnd = s.arrowEnd;
  if (num(s.arrowSize, 0.3, 4)) out.arrowSize = s.arrowSize;
  if (num(s.lineOpacity, 0.05, 1)) out.lineOpacity = s.lineOpacity;
  if (s.fillColor === "none" || hex(s.fillColor)) out.fillColor = s.fillColor;
  if (num(s.fillOpacity, 0.05, 1)) out.fillOpacity = s.fillOpacity;
  if (num(s.strokeWidth, 0, 50)) out.strokeWidth = s.strokeWidth;
  const sh = s.shape;
  if (sh && ["cloud", "polygon", "star", "heart"].includes(sh.kind) && num(sh.sides, 3, 12) && num(sh.inner, 0.1, 0.95)) out.shape = { kind: sh.kind, sides: sh.sides, inner: sh.inner };
  return out;
}

/** Select `value`, adding it as an option if it isn't one of the presets. */
function setSelect(sel: HTMLSelectElement, value: string, label: string): void {
  if (![...sel.options].some((o) => o.value === value)) sel.add(new Option(label, value));
  sel.value = value;
}

function heading(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "pop-h";
  h.textContent = text;
  return h;
}

function note(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "pop-note";
  p.textContent = text;
  return p;
}

function unit(text: string): HTMLElement {
  const u = document.createElement("span");
  u.className = "muted small";
  u.textContent = text;
  return u;
}

function swatches(colors: string[], current: string, pick: (c: string) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "pop-swatches";
  for (const c of colors) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = c;
    b.title = c;
    b.classList.toggle("on", c.toLowerCase() === current.toLowerCase());
    b.addEventListener("click", () => pick(c));
    row.appendChild(b);
  }
  const custom = document.createElement("input");
  custom.type = "color";
  custom.value = current;
  custom.title = "Other color";
  custom.addEventListener("change", () => pick(custom.value));
  row.appendChild(custom);
  return row;
}

function range(value: number, min: number, max: number, onChange: (v: number, done: boolean) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "pop-row";
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = "5";
  input.value = String(value);
  const out = document.createElement("span");
  out.className = "pop-val";
  out.textContent = `${value}%`;
  input.addEventListener("input", () => {
    out.textContent = `${input.value}%`;
    onChange(Number(input.value), false);
  });
  input.addEventListener("change", () => {
    onChange(Number(input.value), true);
    input.blur();
  });
  row.append(input, out);
  return row;
}

function choice<T extends string>(items: [T, string][], current: T, pick: (v: T) => void, inline = false): HTMLElement {
  const box = document.createElement("div");
  box.className = inline ? "pop-choice inline" : "pop-choice";
  for (const [v, label] of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset.value = v;
    b.classList.toggle("on", v === current);
    if (inline) b.className += ` font-${v}`;
    b.addEventListener("click", () => pick(v));
    box.appendChild(b);
  }
  return box;
}

function numberField(label: string, value: number, min: number, max: number, set: (v: number) => void, step = 1): HTMLElement {
  const l = document.createElement("label");
  l.className = "pop-num";
  const span = document.createElement("span");
  span.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const apply = () => {
    const v = parseFloat(input.value);
    if (v === value) return;
    if (Number.isFinite(v) && v >= min && v <= max) {
      input.blur();
      set(v);
    } else input.value = String(value);
  };
  input.addEventListener("change", apply);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") apply();
  });
  l.append(span, input);
  return l;
}
