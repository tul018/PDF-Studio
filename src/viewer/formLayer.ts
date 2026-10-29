import type { DocumentStore } from "../core/documents";
import { viewRect } from "../core/viewport";
import type { History } from "../edit/history";
import { setFormValue, type FormValue } from "../edit/model";
import type { Decorator, Slot } from "./viewer";

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfAnnotation = any;

interface LayerState {
  div: HTMLDivElement;
  annots: PdfAnnotation[] | null;
  zoom: number;
}

/**
 * Interactive AcroForm fields and hyperlinks, as lightweight HTML elements
 * positioned over the canvas. Values live in the edit model and are written
 * with pdf-lib on save. Built only for mounted pages.
 */
export class FormLinkLayer implements Decorator {
  private layers = new WeakMap<Slot, LayerState>();
  private annotCache = new Map<string, Promise<PdfAnnotation[]>>();
  /** docId|fieldName -> whether the document has any fillable fields */
  hasForms = false;
  onLink: (url: string) => void = () => {};
  onGoto: (docId: string, pageIndex: number) => void = () => {};
  onFormsDetected: () => void = () => {};

  constructor(
    private store: DocumentStore,
    private history: History,
  ) {}

  reset(): void {
    this.annotCache.clear();
    this.hasForms = false;
  }

  decorate(slot: Slot): void {
    if (!slot.ref.docId) return;
    let st = this.layers.get(slot);
    if (!st) {
      const div = document.createElement("div");
      div.className = "form-layer";
      slot.layers.appendChild(div);
      st = { div, annots: null, zoom: 0 };
      this.layers.set(slot, st);
      void this.load(slot, st);
      return;
    }
    if (st.annots) this.build(slot, st);
  }

  undecorate(slot: Slot): void {
    this.layers.get(slot)?.div.remove();
    this.layers.delete(slot);
  }

  /** Re-sync values after undo/redo. */
  refreshValues(slots: Slot[]): void {
    for (const s of slots) {
      const st = this.layers.get(s);
      if (st?.annots) this.build(s, st);
    }
  }

  private async load(slot: Slot, st: LayerState): Promise<void> {
    const key = `${slot.ref.docId}:${slot.ref.srcIndex}`;
    let p = this.annotCache.get(key);
    if (!p) {
      const pageP = this.store.getPage(slot.ref);
      if (!pageP) return;
      p = pageP.then((page) => page.getAnnotations({ intent: "display" })).catch(() => []);
      this.annotCache.set(key, p);
      // Keep the cache bounded for very long documents.
      if (this.annotCache.size > 400) this.annotCache.delete(this.annotCache.keys().next().value!);
    }
    const annots = (await p).filter((a) => a.subtype === "Link" || a.subtype === "Widget");
    if (this.layers.get(slot) !== st) return;
    st.annots = annots;
    if (!this.hasForms && annots.some((a) => a.subtype === "Widget" && !a.readOnly)) {
      this.hasForms = true;
      this.onFormsDetected();
    }
    this.build(slot, st);
  }

  private build(slot: Slot, st: LayerState): void {
    const v = slot.view;
    st.div.replaceChildren();
    const docId = slot.ref.docId!;
    const values = this.history.state.formValues;
    for (const a of st.annots ?? []) {
      const [l, t, r, b] = viewRect(v, a.rect);
      const pos = (el: HTMLElement) => {
        Object.assign(el.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
        st.div.appendChild(el);
      };
      if (a.subtype === "Link") {
        if (!a.url && !a.dest && a.action == null) continue;
        const link = document.createElement("a");
        link.className = "pdf-link";
        link.title = a.url ?? "Go to destination";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          if (a.url) this.onLink(a.url);
          else if (a.dest) void this.gotoDest(docId, a.dest);
        });
        pos(link);
        continue;
      }
      if (a.subtype !== "Widget" || !a.fieldName || a.hidden) continue;
      const key = `${docId}|${a.fieldName}`;
      const stored = values[key];
      const fontPx = Math.max(8, Math.min((b - t) * 0.7, (a.textFormat?.fontSize || 11) * v.scale || 12));
      let el: HTMLElement | null = null;
      if (a.fieldType === "Tx") {
        const input = a.multiLine ? document.createElement("textarea") : document.createElement("input");
        input.value = (stored as string) ?? (a.fieldValue as string) ?? "";
        if (a.maxLen && input instanceof HTMLInputElement) input.maxLength = a.maxLen;
        if (a.password && input instanceof HTMLInputElement) input.type = "password";
        input.style.fontSize = `${a.multiLine ? Math.min(fontPx, 12 * v.scale) : fontPx}px`;
        if (a.comb && a.maxLen > 0 && input instanceof HTMLInputElement) {
          // Comb field: spread the characters so each sits in its own printed box.
          const cell = (r - l) / a.maxLen;
          const glyph = Math.min(fontPx, cell * 1.2);
          const gap = cell - glyph * 0.6; // Courier advance = 0.6 em
          input.classList.add("comb");
          Object.assign(input.style, { fontSize: `${glyph}px`, letterSpacing: `${gap}px`, paddingLeft: `${gap / 2}px` });
        }
        input.addEventListener("change", () => this.set(key, input.value));
        el = input;
      } else if (a.fieldType === "Btn" && (a.checkBox || a.radioButton)) {
        const input = document.createElement("input");
        input.type = a.radioButton ? "radio" : "checkbox";
        // Boxes sharing one field name (e.g. "Individual" / "Juristic person")
        // each have their own on-value: only the box whose value is stored is ticked.
        const onValue: string | undefined = a.radioButton ? a.buttonValue : a.exportValue;
        input.dataset.fieldKey = key;
        input.dataset.onValue = onValue ?? "";
        if (a.radioButton) input.name = key;
        const cur = stored ?? a.fieldValue;
        input.checked =
          typeof cur === "boolean" ? cur : cur != null && cur !== "Off" && (onValue == null || cur === onValue);
        input.addEventListener("change", () => {
          if (a.radioButton && !input.checked) return;
          if (onValue == null) return this.set(key, input.checked);
          this.set(key, input.checked ? onValue : "Off");
          this.syncButtons(key, input.checked ? onValue : "Off");
        });
        el = input;
      } else if (a.fieldType === "Ch") {
        const sel = document.createElement("select");
        if (a.multiSelect) sel.multiple = true;
        for (const o of a.options ?? []) {
          const opt = document.createElement("option");
          opt.value = o.exportValue ?? o.displayValue;
          opt.textContent = o.displayValue ?? o.exportValue;
          sel.appendChild(opt);
        }
        const cur = stored ?? a.fieldValue;
        const arr = Array.isArray(cur) ? cur : cur != null ? [cur] : [];
        for (const opt of sel.options) opt.selected = arr.includes(opt.value);
        sel.style.fontSize = `${fontPx}px`;
        sel.addEventListener("change", () =>
          this.set(key, sel.multiple ? [...sel.selectedOptions].map((o) => o.value) : sel.value),
        );
        el = sel;
      }
      if (!el) continue;
      el.classList.add("form-field");
      if (a.readOnly) (el as HTMLInputElement).disabled = true;
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("keydown", (e) => e.stopPropagation());
      pos(el);
    }
    st.zoom = v.scale;
  }

  private set(key: string, value: FormValue): void {
    this.history.push(setFormValue(this.history.state, key, value));
  }

  /** Other boxes of the same field, possibly on other mounted pages. */
  private syncButtons(key: string, value: string): void {
    for (const el of document.querySelectorAll<HTMLInputElement>(`.form-layer input[data-field-key="${CSS.escape(key)}"]`)) {
      el.checked = value !== "Off" && el.dataset.onValue === value;
    }
  }

  private async gotoDest(docId: string, dest: string | unknown[]): Promise<void> {
    const pdf = this.store.docs.get(docId)?.pdf;
    if (!pdf) return;
    try {
      const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!explicit) return;
      const ref = explicit[0];
      const index = typeof ref === "number" ? ref : await pdf.getPageIndex(ref as any);
      this.onGoto(docId, index);
    } catch (e) {
      console.warn("bad destination", e);
    }
  }
}
