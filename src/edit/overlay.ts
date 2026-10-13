import type { History } from "./history";
import {
  addAnnotation,
  annotationBounds,
  removeAnnotations,
  rotVec,
  simplifyPoints,
  TEXT_FONTS,
  textLines,
  translateAnnotation,
  uid,
  updateAnnotation,
  type Annotation,
  type Box,
  type EditState,
  type ShapeKind,
  type StoredImage,
} from "./model";
import type { Decorator, Slot, Viewer } from "../viewer/viewer";

export type Tool =
  | "select"
  | "hand"
  | "highlight"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "ink"
  | "text"
  | "note"
  | "whiteout"
  | "redact";

export interface ToolOptions {
  color: string;
  strokeWidth: number;
  fontSize: number;
  highlightColor: string;
}

export interface SearchHitProvider {
  hitsFor(pageId: string): { rects: number[][]; current: boolean }[];
}

const SVGNS = "http://www.w3.org/2000/svg";
const SHAPE_TOOLS: Tool[] = ["highlight", "rect", "ellipse", "whiteout", "redact"];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

interface PageState {
  svg: SVGSVGElement;
  root: SVGGElement;
  handlersAttached: boolean;
}

/**
 * Draws the edit model on top of each mounted page (SVG, resolution
 * independent - zooming never re-rasterizes annotations) and turns pointer
 * input into model edits. Pen/touch/mouse share one Pointer Events path, so
 * Apple Pencil, Windows Ink and mouse behave identically.
 */
export class AnnotationOverlay implements Decorator {
  tool: Tool = "select";
  options: ToolOptions = { color: "#e53935", strokeWidth: 2, fontSize: 14, highlightColor: "#ffeb3b" };
  selectedId: string | null = null;
  private pages = new WeakMap<Slot, PageState>();
  private editing: { id: string; ta: HTMLTextAreaElement; before?: EditState } | null = null;
  onSelectionChange: (a: Annotation | null) => void = () => {};
  onRequestNoteText: (initial: string) => Promise<string | null> = async () => null;

  constructor(
    private viewer: Viewer,
    private history: History,
    private images: Map<string, StoredImage>,
    private hits: SearchHitProvider,
  ) {}

  get state(): EditState {
    return this.history.state;
  }

  setTool(t: Tool): void {
    this.commitTextEdit();
    this.tool = t;
    if (t !== "select") this.select(null);
    document.body.dataset.activeTool = t;
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    const prev = this.selectedId;
    this.selectedId = id;
    const a = id ? (this.state.annotations.find((x) => x.id === id) ?? null) : null;
    this.onSelectionChange(a);
    for (const pid of new Set([prev, id].map((x) => this.state.annotations.find((a) => a.id === x)?.pageId))) {
      if (pid) this.viewer.redecorate(pid);
    }
  }

  deleteSelected(): boolean {
    if (!this.selectedId) return false;
    const id = this.selectedId;
    this.select(null);
    this.history.push(removeAnnotations(this.state, new Set([id])));
    return true;
  }

  /** Recolor / restyle the selected annotation. */
  styleSelected(patch: Partial<{ color: string; width: number; strokeWidth: number; fontSize: number }>): void {
    const a = this.state.annotations.find((x) => x.id === this.selectedId);
    if (!a) return;
    const p: Record<string, unknown> = {};
    if (patch.color && "color" in a) p.color = patch.color;
    if (patch.strokeWidth !== undefined && "strokeWidth" in a) p.strokeWidth = patch.strokeWidth;
    if (patch.strokeWidth !== undefined && "width" in a) p.width = patch.strokeWidth;
    if (patch.fontSize !== undefined && a.type === "text") p.fontSize = patch.fontSize;
    if (Object.keys(p).length) this.history.push(updateAnnotation(this.state, a.id, p as Partial<Annotation>));
  }

  // ----------------------------------------------------------- decorator

  decorate(slot: Slot): void {
    let ps = this.pages.get(slot);
    if (!ps) {
      const s = svg("svg", { class: "annot-layer" }) as SVGSVGElement;
      const root = svg("g");
      s.appendChild(root);
      slot.layers.appendChild(s);
      ps = { svg: s, root, handlersAttached: false };
      this.pages.set(slot, ps);
    }
    if (!ps.handlersAttached) {
      this.attachHandlers(slot);
      ps.handlersAttached = true;
    }
    const v = slot.view;
    ps.svg.setAttribute("width", String(v.width));
    ps.svg.setAttribute("height", String(v.height));
    ps.svg.setAttribute("viewBox", `0 0 ${v.width} ${v.height}`);
    ps.root.setAttribute("transform", `matrix(${v.transform.join(" ")})`);
    this.renderPage(slot, ps.root);
    if (this.editing) this.positionEditor(slot);
  }

  undecorate(slot: Slot): void {
    const ps = this.pages.get(slot);
    ps?.svg.remove();
    this.pages.delete(slot);
  }

  private renderPage(slot: Slot, root: SVGGElement): void {
    root.replaceChildren();
    const pageId = slot.ref.id;
    for (const hit of this.hits.hitsFor(pageId)) {
      for (const r of hit.rects) {
        root.appendChild(
          svg("rect", {
            class: hit.current ? "search-hit current" : "search-hit",
            x: r[0],
            y: r[1],
            width: r[2],
            height: r[3],
          }),
        );
      }
    }
    for (const a of this.state.annotations) {
      if (a.pageId !== pageId) continue;
      if (this.editing?.id === a.id) continue;
      const el = this.renderAnnotation(a);
      if (!el) continue;
      el.dataset.id = a.id;
      el.classList.add("annot");
      root.appendChild(el);
    }
    const sel = this.state.annotations.find((a) => a.id === this.selectedId && a.pageId === pageId);
    if (sel) {
      const [x0, y0, x1, y1] = annotationBounds(sel);
      const pad = 3 / slot.view.scale;
      root.appendChild(
        svg("rect", {
          class: "selection-box",
          x: x0 - pad,
          y: y0 - pad,
          width: x1 - x0 + pad * 2,
          height: y1 - y0 + pad * 2,
          "stroke-width": 1.5 / slot.view.scale,
        }),
      );
      if ("box" in sel) {
        const [hx, hy] = boxCorner(sel.box, sel.box.w, sel.box.h);
        const handle = svg("circle", {
          class: "resize-handle",
          cx: hx,
          cy: hy,
          r: 7 / slot.view.scale,
          "stroke-width": 1.5 / slot.view.scale,
        });
        handle.dataset.handle = sel.id;
        root.appendChild(handle);
      }
    }
  }

  private renderAnnotation(a: Annotation): SVGElement | null {
    switch (a.type) {
      case "highlight":
      case "rect":
      case "ellipse":
      case "whiteout":
      case "redact": {
        const g = boxGroup(a.box);
        const sw = a.strokeWidth;
        if (a.type === "ellipse") {
          g.appendChild(
            svg("ellipse", {
              cx: a.box.w / 2,
              cy: a.box.h / 2,
              rx: Math.max(0, a.box.w / 2 - sw / 2),
              ry: Math.max(0, a.box.h / 2 - sw / 2),
              fill: "none",
              stroke: a.color,
              "stroke-width": sw,
              "stroke-opacity": a.opacity,
            }),
          );
        } else {
          const attrs: Record<string, string | number> = { x: 0, y: 0, width: a.box.w, height: a.box.h };
          if (a.type === "highlight") Object.assign(attrs, { fill: a.color, "fill-opacity": a.opacity, class: "hl" });
          else if (a.type === "whiteout") Object.assign(attrs, { fill: "#ffffff" });
          else if (a.type === "redact") Object.assign(attrs, { fill: "#000000", class: "redact" });
          else
            Object.assign(attrs, {
              x: sw / 2,
              y: sw / 2,
              width: Math.max(0, a.box.w - sw),
              height: Math.max(0, a.box.h - sw),
              fill: "none",
              stroke: a.color,
              "stroke-width": sw,
              "stroke-opacity": a.opacity,
            });
          g.appendChild(svg("rect", attrs));
        }
        return g;
      }
      case "ink": {
        const pts: string[] = [];
        for (let i = 0; i < a.points.length; i += 2) pts.push(`${a.points[i]},${a.points[i + 1]}`);
        return svg("polyline", {
          points: pts.join(" "),
          fill: "none",
          stroke: a.color,
          "stroke-width": a.width,
          "stroke-opacity": a.opacity,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        });
      }
      case "line":
      case "arrow": {
        const g = svg("g", { stroke: a.color, "stroke-width": a.width, "stroke-linecap": "round", fill: "none" });
        g.appendChild(svg("line", { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }));
        if (a.type === "arrow") {
          const [p1, p2] = arrowHead(a.x1, a.y1, a.x2, a.y2, a.width);
          g.appendChild(svg("polyline", { points: `${p1[0]},${p1[1]} ${a.x2},${a.y2} ${p2[0]},${p2[1]}` }));
        }
        // Fat invisible line for easier picking.
        g.appendChild(svg("line", { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, "stroke-width": a.width + 8, stroke: "transparent" }));
        return g;
      }
      case "text": {
        const g = boxGroup(a.box);
        const inner = svg("g", { transform: "scale(1,-1)" });
        g.appendChild(inner);
        inner.appendChild(svg("rect", { x: 0, y: -a.box.h, width: a.box.w, height: a.box.h, fill: "transparent" }));
        for (const line of textLines(a)) {
          const t = svg("text", {
            x: 2,
            y: -a.box.h + line.baseline + 2,
            fill: a.color,
            "font-size": a.fontSize,
            "font-family": TEXT_FONTS,
          });
          t.textContent = line.text || " ";
          inner.appendChild(t);
        }
        return g;
      }
      case "image": {
        const img = this.images.get(a.imageId);
        if (!img) return null;
        const g = boxGroup(a.box);
        const inner = svg("g", { transform: "scale(1,-1)" });
        g.appendChild(inner);
        inner.appendChild(
          svg("image", { href: img.url, x: 0, y: -a.box.h, width: a.box.w, height: a.box.h, preserveAspectRatio: "none" }),
        );
        return g;
      }
      case "note": {
        const g = svg("g", { transform: `translate(${a.x},${a.y}) scale(1,-1)` });
        g.appendChild(svg("rect", { x: 0, y: 0, width: 20, height: 18, rx: 2, fill: a.color, stroke: "#5d4300", "stroke-width": 0.8 }));
        g.appendChild(svg("path", { d: "M4 13 L4 19 L10 13", fill: a.color, stroke: "#5d4300", "stroke-width": 0.8 }));
        for (const y of [5, 9]) g.appendChild(svg("line", { x1: 4, y1: y, x2: 16, y2: y, stroke: "#5d4300", "stroke-width": 1 }));
        const title = svg("title");
        title.textContent = a.text;
        g.appendChild(title);
        return g;
      }
    }
  }

  // ----------------------------------------------------------- input

  private attachHandlers(slot: Slot): void {
    const layer = slot.layers;
    layer.addEventListener("pointerdown", (e) => this.onPointerDown(slot, e));
    layer.addEventListener("dblclick", (e) => {
      const id = (e.target as Element).closest<SVGElement>(".annot")?.dataset.id;
      const a = id && this.state.annotations.find((x) => x.id === id);
      if (a && a.type === "text") this.startTextEdit(slot, a.id);
      if (a && a.type === "note") void this.editNote(a.id);
    });
  }

  private local(slot: Slot, e: PointerEvent | MouseEvent): [number, number] {
    const r = slot.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onPointerDown(slot: Slot, e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (!e.isPrimary) return;
    this.commitTextEdit();
    const target = e.target as Element;
    const tool = this.tool;

    if (tool === "select") {
      const handleId = (target as SVGElement).dataset?.handle;
      if (handleId) return this.dragResize(slot, e, handleId);
      const id = target.closest<SVGElement>(".annot")?.dataset.id;
      if (id) {
        this.select(id);
        this.dragMove(slot, e, id);
      } else {
        this.select(null);
      }
      return;
    }
    if (tool === "hand") return this.dragPan(e);

    e.preventDefault();
    const v = slot.view;
    const [sx, sy] = this.local(slot, e);
    const layer = slot.layers;
    layer.setPointerCapture(e.pointerId);
    const s0 = this.state;
    const pageId = slot.ref.id;
    const o = this.options;

    if (tool === "text") {
      const w = 160,
        h = o.fontSize * 1.7;
      const [x, y] = v.toPdf(sx, sy + h * v.scale);
      const a: Annotation = {
        id: uid("a"),
        pageId,
        type: "text",
        box: { x, y, w, h, rot: v.rotation },
        text: "",
        fontSize: o.fontSize,
        color: o.color,
      };
      this.history.replace(addAnnotation(s0, a)); // committed as one step on edit end
      this.setTool("select");
      this.select(a.id);
      this.startTextEdit(slot, a.id, s0);
      return;
    }

    if (tool === "note") {
      const [x, y] = v.toPdf(sx, sy);
      void this.onRequestNoteText("").then((text) => {
        if (!text) return;
        const a: Annotation = { id: uid("a"), pageId, type: "note", x, y, text, color: "#ffd54f" };
        this.history.push(addAnnotation(this.state, a));
      });
      return;
    }

    let current: Annotation | null = null;
    const pts: number[] = [];
    const move = (ev: PointerEvent) => {
      const [cx, cy] = this.local(slot, ev);
      if (tool === "ink") {
        // Use coalesced events for smooth Apple Pencil / Surface Pen strokes.
        const evs = ev.getCoalescedEvents?.() ?? [ev];
        for (const ce of evs.length ? evs : [ev]) {
          const [lx, ly] = this.local(slot, ce);
          const [px, py] = v.toPdf(lx, ly);
          pts.push(px, py);
        }
        current = {
          id: current?.id ?? uid("a"),
          pageId,
          type: "ink",
          points: pts.slice(),
          color: o.color,
          width: o.strokeWidth,
          opacity: 1,
        };
      } else if (tool === "line" || tool === "arrow") {
        const [x1, y1] = v.toPdf(sx, sy);
        const [x2, y2] = v.toPdf(cx, cy);
        current = { id: current?.id ?? uid("a"), pageId, type: tool, x1, y1, x2, y2, color: o.color, width: o.strokeWidth };
      } else if (SHAPE_TOOLS.includes(tool)) {
        const box = boxFromView(v, sx, sy, cx, cy);
        const isHl = tool === "highlight";
        current = {
          id: current?.id ?? uid("a"),
          pageId,
          type: tool as ShapeKind,
          box,
          color: isHl ? o.highlightColor : o.color,
          strokeWidth: o.strokeWidth,
          opacity: isHl ? 0.45 : 1,
        };
      }
      if (current) this.history.replace(addAnnotation(s0, current));
    };
    if (tool === "ink") {
      const [px, py] = v.toPdf(sx, sy);
      pts.push(px, py);
    }
    const up = () => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      this.history.replace(s0);
      if (!current) return;
      const c = current as Annotation;
      if (c.type === "ink") {
        if (pts.length < 4) pts.push(pts[0] + 0.5, pts[1] + 0.5);
        const simplified = simplifyPoints(pts, 0.35 / Math.max(0.25, v.scale / 2));
        this.history.push(addAnnotation(s0, { ...c, points: simplified }));
        return;
      }
      if ("box" in c && (c.box.w < 3 || c.box.h < 3)) return;
      if ((c.type === "line" || c.type === "arrow") && Math.hypot(c.x2 - c.x1, c.y2 - c.y1) < 3) return;
      this.history.push(addAnnotation(s0, c));
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  }

  private dragMove(slot: Slot, e: PointerEvent, id: string): void {
    const v = slot.view;
    const layer = slot.layers;
    layer.setPointerCapture(e.pointerId);
    const s0 = this.state;
    const a0 = s0.annotations.find((a) => a.id === id)!;
    const [sx, sy] = this.local(slot, e);
    const [px0, py0] = v.toPdf(sx, sy);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const [cx, cy] = this.local(slot, ev);
      if (!moved && Math.hypot(cx - sx, cy - sy) < 3) return;
      moved = true;
      const [px, py] = v.toPdf(cx, cy);
      const next = translateAnnotation(a0, px - px0, py - py0);
      this.history.replace({ ...s0, annotations: s0.annotations.map((a) => (a.id === id ? next : a)) });
    };
    const up = () => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      if (!moved) return;
      const final = this.state;
      this.history.replace(s0);
      this.history.push(final);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  }

  private dragResize(slot: Slot, e: PointerEvent, id: string): void {
    e.stopPropagation();
    const v = slot.view;
    const layer = slot.layers;
    layer.setPointerCapture(e.pointerId);
    const s0 = this.state;
    const a0 = s0.annotations.find((a) => a.id === id) as Annotation & { box: Box };
    const [sx, sy] = this.local(slot, e);
    const [px0, py0] = v.toPdf(sx, sy);
    const keepAspect = a0.type === "image";
    const move = (ev: PointerEvent) => {
      const [cx, cy] = this.local(slot, ev);
      const [px, py] = v.toPdf(cx, cy);
      const [ldx, ldy] = rotVec(-a0.box.rot, px - px0, py - py0);
      let w = Math.max(6, a0.box.w + ldx);
      let h = Math.max(6, a0.box.h + ldy);
      if (keepAspect) h = (w * a0.box.h) / a0.box.w;
      this.history.replace(updateAnnotation(s0, id, { box: { ...a0.box, w, h } } as Partial<Annotation>));
    };
    const up = () => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      const final = this.state;
      this.history.replace(s0);
      this.history.push(final);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
  }

  private dragPan(e: PointerEvent): void {
    const sc = this.viewer.scroller;
    const x0 = e.clientX,
      y0 = e.clientY,
      l0 = sc.scrollLeft,
      t0 = sc.scrollTop;
    const move = (ev: PointerEvent) => {
      sc.scrollLeft = l0 - (ev.clientX - x0);
      sc.scrollTop = t0 - (ev.clientY - y0);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ----------------------------------------------------------- text edit

  /** `before` = state prior to creating a new box: typing + creation become one undo step. */
  startTextEdit(slot: Slot, id: string, before?: EditState): void {
    const a = this.state.annotations.find((x) => x.id === id);
    if (!a || a.type !== "text") return;
    const ta = document.createElement("textarea");
    ta.className = "text-editor";
    ta.value = a.text;
    ta.spellcheck = true;
    this.editing = { id, ta, before };
    slot.layers.appendChild(ta);
    this.positionEditor(slot);
    this.viewer.redecorate(slot.ref.id);
    ta.addEventListener("input", () => this.autosizeEditor(slot));
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        this.commitTextEdit();
      }
    });
    ta.addEventListener("blur", () => this.commitTextEdit());
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    ta.focus();
    requestAnimationFrame(() => ta.focus());
  }

  private positionEditor(slot: Slot): void {
    if (!this.editing) return;
    const a = this.state.annotations.find((x) => x.id === this.editing!.id);
    if (!a || a.type !== "text" || a.pageId !== slot.ref.id) return;
    const v = slot.view;
    const [tlx, tly] = v.toView(...boxCorner(a.box, 0, a.box.h));
    const ta = this.editing.ta;
    Object.assign(ta.style, {
      left: `${tlx}px`,
      top: `${tly}px`,
      width: `${a.box.w * v.scale}px`,
      height: `${a.box.h * v.scale}px`,
      fontSize: `${a.fontSize * v.scale}px`,
      color: a.color,
      transform: `rotate(${v.rotation - a.box.rot}deg)`,
    });
    if (!ta.isConnected) slot.layers.appendChild(ta);
  }

  private autosizeEditor(slot: Slot): void {
    if (!this.editing) return;
    const ta = this.editing.ta;
    const v = slot.view;
    const a = this.state.annotations.find((x) => x.id === this.editing!.id);
    if (!a || a.type !== "text") return;
    const lines = ta.value.split("\n");
    const ctx = measureCtx();
    ctx.font = `${a.fontSize}px ${TEXT_FONTS}`;
    const w = Math.max(60, ...lines.map((l) => ctx.measureText(l).width + 8));
    const h = a.fontSize * (0.5 + lines.length * 1.25);
    ta.style.width = `${Math.max(a.box.w, w) * v.scale}px`;
    ta.style.height = `${h * v.scale}px`;
  }

  commitTextEdit(): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const a = this.state.annotations.find((x) => x.id === ed.id);
    ed.ta.remove();
    if (!a || a.type !== "text") return;
    const text = ed.ta.value.replace(/\s+$/, "");
    if (!text) {
      this.select(null);
      if (ed.before) this.history.replace(ed.before);
      else this.history.push(removeAnnotations(this.state, new Set([a.id])));
      return;
    }
    const ctx = measureCtx();
    ctx.font = `${a.fontSize}px ${TEXT_FONTS}`;
    const lines = text.split("\n");
    const w = Math.max(20, ...lines.map((l) => ctx.measureText(l).width + 6));
    const h = a.fontSize * (0.45 + lines.length * 1.25);
    // Keep the visual top-left fixed while the box grows downwards.
    const [tx, ty] = boxCorner(a.box, 0, a.box.h);
    const [dx, dy] = rotVec(a.box.rot, 0, -h);
    const box: Box = { ...a.box, x: tx + dx, y: ty + dy, w, h };
    if (ed.before) {
      const final = updateAnnotation(this.state, a.id, { text, box } as Partial<Annotation>);
      this.history.replace(ed.before);
      this.history.push(final);
    } else if (text !== a.text || w !== a.box.w || h !== a.box.h) {
      this.history.push(updateAnnotation(this.state, a.id, { text, box } as Partial<Annotation>));
    } else {
      this.viewer.redecorate(a.pageId);
    }
  }

  private async editNote(id: string): Promise<void> {
    const a = this.state.annotations.find((x) => x.id === id);
    if (!a || a.type !== "note") return;
    const text = await this.onRequestNoteText(a.text);
    if (text === null) return;
    if (!text) this.history.push(removeAnnotations(this.state, new Set([id])));
    else this.history.push(updateAnnotation(this.state, id, { text } as Partial<Annotation>));
  }

  /** Turn the current text selection into highlight annotations. */
  highlightSelection(): number {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return 0;
    let state = this.state;
    let count = 0;
    for (const slot of this.viewer.mountedSlots()) {
      const pr = slot.el.getBoundingClientRect();
      for (let i = 0; i < sel.rangeCount; i++) {
        const range = sel.getRangeAt(i);
        if (!range.intersectsNode(slot.el)) continue;
        for (const r of mergeLineRects([...range.getClientRects()])) {
          if (r.width < 1 || r.height < 1) continue;
          if (r.right < pr.left || r.left > pr.right || r.bottom < pr.top || r.top > pr.bottom) continue;
          const box = boxFromView(slot.view, r.left - pr.left, r.top - pr.top, r.right - pr.left, r.bottom - pr.top);
          state = addAnnotation(state, {
            id: uid("a"),
            pageId: slot.ref.id,
            type: "highlight",
            box,
            color: this.options.highlightColor,
            strokeWidth: 0,
            opacity: 0.45,
          });
          count++;
        }
      }
    }
    if (count) {
      this.history.push(state);
      sel.removeAllRanges();
    }
    return count;
  }

  /** Place an image (or signature) centered in the visible part of a page. */
  placeImage(imageId: string, img: StoredImage, maxWidthPt = 220): void {
    const slot =
      this.viewer.slot(this.viewer.pageList[this.viewer.currentIndex]?.id ?? "") ?? this.viewer.mountedSlots()[0];
    if (!slot) return;
    const v = slot.view;
    const sc = this.viewer.scroller;
    const pr = slot.el.getBoundingClientRect();
    const scr = sc.getBoundingClientRect();
    const cx = Math.min(Math.max(scr.left + scr.width / 2 - pr.left, 0), pr.width);
    const cy = Math.min(Math.max(scr.top + scr.height / 2 - pr.top, 0), pr.height);
    const pageWpt = v.width / v.scale;
    const w = Math.min(maxWidthPt, pageWpt * 0.6, img.width);
    const h = (w * img.height) / img.width;
    const box = boxFromView(v, cx - (w * v.scale) / 2, cy - (h * v.scale) / 2, cx + (w * v.scale) / 2, cy + (h * v.scale) / 2);
    const a: Annotation = { id: uid("a"), pageId: slot.ref.id, type: "image", box, imageId };
    this.history.push(addAnnotation(this.state, a));
    this.setTool("select");
    this.select(a.id);
  }
}

// ------------------------------------------------------------------ helpers

function boxGroup(b: Box): SVGGElement {
  return svg("g", { transform: `translate(${b.x},${b.y}) rotate(${b.rot})` }) as SVGGElement;
}

/** User-space position of local point (lx, ly) of a box. */
export function boxCorner(b: Box, lx: number, ly: number): [number, number] {
  const [dx, dy] = rotVec(b.rot, lx, ly);
  return [b.x + dx, b.y + dy];
}

/** Two view-space corners -> Box anchored at the visual bottom-left. */
export function boxFromView(
  v: { toPdf(x: number, y: number): [number, number]; scale: number; rotation: number },
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Box {
  const l = Math.min(ax, bx),
    r = Math.max(ax, bx),
    t = Math.min(ay, by),
    b = Math.max(ay, by);
  const [x, y] = v.toPdf(l, b);
  return { x, y, w: (r - l) / v.scale, h: (b - t) / v.scale, rot: v.rotation };
}

export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): [number[], number[]] {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(8, width * 4);
  const spread = Math.PI / 7;
  return [
    [x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread)],
    [x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread)],
  ];
}

/** Merge per-glyph-run client rects into one rect per line. */
function mergeLineRects(rects: DOMRect[]): DOMRect[] {
  const out: DOMRect[] = [];
  for (const r of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.top - r.top) < r.height * 0.5 && r.left <= last.right + 4) {
      const left = Math.min(last.left, r.left),
        top = Math.min(last.top, r.top);
      out[out.length - 1] = new DOMRect(left, top, Math.max(last.right, r.right) - left, Math.max(last.bottom, r.bottom) - top);
    } else {
      out.push(r);
    }
  }
  return out;
}

let _ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d")!;
  return _ctx;
}
