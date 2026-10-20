import { icon } from "./icons";

/**
 * The left tools panel, like Acrobat's "All tools": the groups of tools, and
 * a group's tools when one is opened (from the list or a mode tab: Edit,
 * Comment, Organize...). Every tool is a button with the same data
 * attributes as the menus (data-tool, data-action, data-pro, data-page-op),
 * so the app's one click handler runs it.
 */
type Run = { tool?: string; action?: string; pro?: string; pageOp?: string };

interface Item {
  label: string;
  icon: string;
  run: Run;
  /** Needs an open document (most tools). */
  doc?: boolean;
}

interface Group {
  id: string;
  label: string;
  icon: string;
  /** Colour class (c-edit, c-comment...). */
  color: string;
  hint: string;
  items: Item[];
}

const D = true;
export const GROUPS: Group[] = [
  {
    id: "edit",
    label: "Edit a PDF",
    icon: "pencilDoc",
    color: "c-edit",
    hint: "Text, images, headers, watermark, page numbers, crop",
    items: [
      { label: "Add text", icon: "text", run: { tool: "text" }, doc: D },
      { label: "Add image", icon: "image", run: { action: "image" }, doc: D },
      { label: "Edit existing text", icon: "pencilDoc", run: { pro: "editText" }, doc: D },
      { label: "Headers, footers & Bates", icon: "layersStack", run: { pro: "headers" }, doc: D },
      { label: "Watermark", icon: "watermark", run: { action: "watermark" }, doc: D },
      { label: "Page numbers", icon: "hash", run: { action: "pageNumbers" }, doc: D },
      { label: "Crop pages", icon: "crop", run: { action: "cropTool" }, doc: D },
      { label: "White-out", icon: "whiteout", run: { tool: "whiteout" }, doc: D },
      { label: "Snapshot (copy an area)", icon: "camera", run: { action: "snapshot" }, doc: D },
    ],
  },
  {
    id: "comment",
    label: "Add comments",
    icon: "note",
    color: "c-comment",
    hint: "Sticky notes, highlight, draw, shapes, arrows",
    items: [
      { label: "Sticky note", icon: "note", run: { tool: "note" }, doc: D },
      { label: "Highlight", icon: "highlight", run: { tool: "highlight" }, doc: D },
      { label: "Draw", icon: "ink", run: { tool: "ink" }, doc: D },
      { label: "Eraser", icon: "eraser", run: { tool: "eraser" }, doc: D },
      { label: "Shapes", icon: "shape", run: { tool: "shape" }, doc: D },
      { label: "Line & arrow", icon: "arrow", run: { tool: "arrow" }, doc: D },
      { label: "Box", icon: "rect", run: { tool: "rect" }, doc: D },
      { label: "Circle", icon: "ellipse", run: { tool: "ellipse" }, doc: D },
      { label: "Comments list", icon: "note", run: { action: "commentsList" }, doc: D },
      { label: "Mark this position", icon: "mark", run: { action: "mark" }, doc: D },
    ],
  },
  {
    id: "organize",
    label: "Organize pages",
    icon: "grid",
    color: "c-organize",
    hint: "Rotate, insert, extract, split, cut, delete, combine",
    items: [
      { label: "Rotate left", icon: "rotL", run: { pageOp: "rotL" }, doc: D },
      { label: "Rotate right", icon: "rotR", run: { pageOp: "rotR" }, doc: D },
      { label: "Insert blank page", icon: "plus", run: { pageOp: "blank" }, doc: D },
      { label: "Insert pages from a PDF", icon: "merge", run: { pageOp: "merge" }, doc: D },
      { label: "Extract or split pages", icon: "extract", run: { pageOp: "extract" }, doc: D },
      { label: "Cut pages into pieces", icon: "cutPage", run: { pageOp: "cut" }, doc: D },
      { label: "Move pages", icon: "moveTo", run: { pageOp: "moveTo" }, doc: D },
      { label: "Page labels", icon: "hash", run: { pageOp: "labels" }, doc: D },
      { label: "Delete pages", icon: "trash", run: { pageOp: "delete" }, doc: D },
      { label: "Combine files", icon: "merge", run: { action: "mergeFiles" } },
    ],
  },
  {
    id: "sign",
    label: "Fill & Sign",
    icon: "sign",
    color: "c-sign",
    hint: "Sign, stamps, form fields, form data",
    items: [
      { label: "Sign", icon: "sign", run: { action: "signature" }, doc: D },
      { label: "Stamp", icon: "stamp", run: { action: "stamp" }, doc: D },
      { label: "Create form fields", icon: "form", run: { pro: "forms" }, doc: D },
      { label: "Fill from a data file", icon: "open", run: { action: "importForm" }, doc: D },
      { label: "Export form data", icon: "export", run: { action: "exportForm" }, doc: D },
      { label: "Certificate signature", icon: "badge", run: { pro: "certificate" }, doc: D },
    ],
  },
  {
    id: "protect",
    label: "Protect & redact",
    icon: "shield",
    color: "c-protect",
    hint: "Password, redaction, hidden information",
    items: [
      { label: "Protect with a password", icon: "lock", run: { action: "protect" }, doc: D },
      { label: "Redact", icon: "redact", run: { tool: "redact" }, doc: D },
      { label: "Redact by search", icon: "search", run: { pro: "redactSearch" }, doc: D },
      { label: "Remove hidden information", icon: "broom", run: { pro: "sanitize" }, doc: D },
    ],
  },
  {
    id: "convert",
    label: "Convert & export",
    icon: "export",
    color: "c-convert",
    hint: "Word, Excel, images, PDF/A, smaller file, OCR",
    items: [
      { label: "Export to Word", icon: "word", run: { pro: "word" }, doc: D },
      { label: "Export to Excel", icon: "excel", run: { pro: "excel" }, doc: D },
      { label: "Pages as images", icon: "image", run: { pageOp: "exportImages" }, doc: D },
      { label: "PDF/A archive copy", icon: "pdfa", run: { pro: "archive" }, doc: D },
      { label: "Compress (smaller copy)", icon: "shrink", run: { action: "shrink" }, doc: D },
      { label: "Recognize text (OCR)", icon: "ocr", run: { action: "ocr" }, doc: D },
      { label: "PDF from photos", icon: "photos", run: { action: "fromPhotos" } },
      { label: "Print", icon: "print", run: { action: "print" }, doc: D },
    ],
  },
  {
    id: "tools",
    label: "More tools",
    icon: "gear",
    color: "c-tools",
    hint: "Compare, measure, QR codes, batch, read aloud, live",
    items: [
      { label: "Compare files", icon: "compare", run: { pro: "compare" }, doc: D },
      { label: "Measure", icon: "ruler", run: { pro: "measure" }, doc: D },
      { label: "Find QR codes", icon: "qr", run: { pro: "qr" }, doc: D },
      { label: "Add QR code", icon: "qr", run: { pro: "qrStamp" }, doc: D },
      { label: "Batch actions", icon: "layersStack", run: { pro: "batch" }, doc: D },
      { label: "Read aloud", icon: "speaker", run: { action: "readAloud" }, doc: D },
      { label: "Search a folder", icon: "folderSearch", run: { action: "folderSearch" } },
      { label: "Work together live", icon: "users", run: { action: "live" } },
      { label: "Connect Claude", icon: "sparkle", run: { action: "connector" } },
    ],
  },
];

/** Mode tabs on the command bar open these groups. */
const MODE_GROUP: Record<string, string> = { edit: "edit", comment: "comment", organize: "organize", sign: "sign", protect: "protect", convert: "convert" };

const KEY = "pdfstudio:toolpanel";

export class ToolPanel {
  private view = "all";

  constructor(private root: HTMLElement) {
    root.addEventListener("click", (e) => {
      const t = e.target as Element;
      const g = t.closest<HTMLElement>("[data-group]");
      if (g) return this.show(g.dataset.group!);
      if (t.closest("[data-tp-back]")) return this.show("all");
      if (t.closest("[data-tp-close]")) return this.setOpen(false);
    });
    document.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        const m = b.dataset.mode!;
        // Clicking the open mode again closes the panel, like Acrobat.
        if (this.isOpen && this.view === (MODE_GROUP[m] ?? "all")) return this.setOpen(false);
        this.show(MODE_GROUP[m] ?? "all");
      }),
    );
    let open = true;
    try {
      open = localStorage.getItem(KEY) !== "0";
    } catch {
      /* default open */
    }
    this.render();
    this.setOpen(open && window.innerWidth >= 900);
  }

  get isOpen(): boolean {
    return !document.body.classList.contains("toolpanel-hidden");
  }

  setOpen(open: boolean): void {
    document.body.classList.toggle("toolpanel-hidden", !open);
    try {
      localStorage.setItem(KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.syncModes();
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  /** "all" (the groups) or one group's tools. */
  show(view: string): void {
    this.view = view;
    this.render();
    this.setOpen(true);
  }

  private syncModes(): void {
    document.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => {
      const m = b.dataset.mode!;
      b.classList.toggle("on", this.isOpen && this.view === (MODE_GROUP[m] ?? "all"));
    });
  }

  private render(): void {
    const head = (title: string, back: boolean) =>
      `<div class="tp-head">${back ? `<button class="tp-back" data-tp-back title="All tools" aria-label="All tools">${icon("prev")}</button>` : ""}<h2>${title}</h2><button class="icon-btn small" data-tp-close title="Close tools" aria-label="Close tools">${icon("close")}</button></div>`;
    if (this.view === "all") {
      this.root.innerHTML =
        head("All tools", false) +
        `<div class="tp-list">${GROUPS.map(
          (g) =>
            `<button class="tp-group" data-group="${g.id}"><span class="tp-icon ${g.color}">${icon(g.icon)}</span><span class="tp-text"><span class="tp-label">${g.label}</span><span class="tp-hint">${g.hint}</span></span></button>`,
        ).join("")}</div>`;
    } else {
      const g = GROUPS.find((x) => x.id === this.view) ?? GROUPS[0];
      this.root.innerHTML = head(g.label, true) + `<div class="tp-list">${g.items.map((it) => this.item(it, g.color)).join("")}</div>`;
    }
    // Tools that need a document start disabled with none open (the app keeps this in step).
    const has = document.body.classList.contains("has-doc");
    this.root.querySelectorAll<HTMLButtonElement>("[data-needs-doc]").forEach((b) => (b.disabled = !has));
    this.syncModes();
  }

  private item(it: Item, color: string): string {
    const attrs = Object.entries(it.run)
      .map(([k, v]) => `data-${k === "pageOp" ? "page-op" : k}="${v}"`)
      .join(" ");
    return `<button class="tp-item" ${attrs}${it.doc ? " data-needs-doc" : ""}><span class="tp-icon ${color}">${icon(it.icon)}</span><span class="tp-label">${it.label}</span></button>`;
  }
}
