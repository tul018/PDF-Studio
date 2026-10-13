import type { DocumentStore } from "../core/documents";
import type { Annotation, EditState, FormValue, PageRef, StoredImage } from "../edit/model";
import { TEXT_FONTS, textLines } from "../edit/model";
import type { PlanPage, SavePlan } from "./applyEdits";
import SaveWorker from "./save.worker?worker";

/** Characters outside printable ASCII + Latin-1 can't use the built-in font. */
const NEEDS_RASTER_TEXT = /[^\n -~ -ÿ]/;
const RASTER_MAX_PIXELS = 12 * 1024 * 1024;

export interface SaveOptions {
  pages?: readonly PageRef[]; // subset (extract); default = all
  onProgress?: (label: string, fraction: number) => void;
}

/**
 * Main-thread half of saving: gathers bytes, pre-renders the few things that
 * need a browser (true redaction rasters, non-Latin text), then hands
 * everything to the worker - transferring buffers, not copying them.
 */
export async function buildPdf(
  state: EditState,
  store: DocumentStore,
  images: Map<string, StoredImage>,
  opts: SaveOptions = {},
): Promise<Uint8Array> {
  const progress = opts.onProgress ?? (() => {});
  const pages = opts.pages ?? state.pages;
  const byPage = new Map<string, Annotation[]>();
  for (const a of state.annotations) {
    const list = byPage.get(a.pageId);
    if (list) list.push(a);
    else byPage.set(a.pageId, [a]);
  }

  const planPages: PlanPage[] = [];
  const needBytes = new Set<string>();
  const textImages: Record<string, Uint8Array> = {};
  const usedImages = new Set<string>();
  let rastered = 0;
  const rasterTotal = pages.filter((p) => mustRaster(p, byPage, store)).length;

  for (const ref of pages) {
    const annotations = byPage.get(ref.id) ?? [];
    const pp: PlanPage = {
      docId: ref.docId,
      srcIndex: ref.srcIndex,
      rotation: ref.rotation,
      blank: ref.blank,
      annotations,
    };
    if (mustRaster(ref, byPage, store)) {
      progress("Applying redactions", rastered / Math.max(1, rasterTotal));
      pp.raster = await rasterizePage(ref, store, annotations.filter((a) => a.type === "redact"));
      rastered++;
    } else if (ref.docId) {
      needBytes.add(ref.docId);
    }
    for (const a of annotations) {
      if (a.type === "image") usedImages.add(a.imageId);
      if (a.type === "text" && NEEDS_RASTER_TEXT.test(a.text)) textImages[a.id] = await renderTextPng(a);
    }
    planPages.push(pp);
  }

  progress("Reading file", 0);
  const sources: Record<string, Uint8Array> = {};
  const transfer: ArrayBuffer[] = [];
  for (const id of needBytes) {
    const doc = store.docs.get(id)!;
    const bytes = await doc.source.readAll();
    sources[id] = doc.source.freshReadAll ? bytes : bytes.slice();
    transfer.push(sources[id].buffer as ArrayBuffer);
  }

  const formValues: Record<string, Record<string, FormValue>> = {};
  for (const [key, v] of Object.entries(state.formValues)) {
    const i = key.indexOf("|");
    (formValues[key.slice(0, i)] ??= {})[key.slice(i + 1)] = v;
  }

  const imgs: SavePlan["images"] = {};
  for (const id of usedImages) {
    const im = images.get(id);
    if (im) imgs[id] = { bytes: im.bytes.slice(), mime: im.mime };
  }

  const plan: SavePlan = { sources, pages: planPages, formValues, images: imgs, textImages };
  progress("Writing PDF", 0);
  return runWorker(plan, transfer, (f) => progress("Writing PDF", f));
}

function mustRaster(ref: PageRef, byPage: Map<string, Annotation[]>, store: DocumentStore): boolean {
  if (!ref.docId) return false;
  if (store.docs.get(ref.docId)?.encrypted) return true;
  return (byPage.get(ref.id) ?? []).some((a) => a.type === "redact");
}

function runWorker(plan: SavePlan, transfer: ArrayBuffer[], onProgress: (f: number) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const w = new SaveWorker();
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress") onProgress(m.done / Math.max(1, m.total));
      else if (m.type === "done") {
        w.terminate();
        resolve(m.bytes as Uint8Array);
      } else if (m.type === "error") {
        w.terminate();
        const err = new Error(m.message);
        err.name = m.name;
        reject(err);
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "Save worker crashed"));
    };
    w.postMessage(plan, transfer);
  });
}

/**
 * True redaction: the page is re-rendered to an image with the boxes burned
 * in, and the original page (text, vectors, hidden layers) is discarded.
 * A black rectangle drawn over text - what many tools call "redaction" -
 * leaves the text selectable underneath.
 */
async function rasterizePage(
  ref: PageRef,
  store: DocumentStore,
  redactions: Annotation[],
): Promise<PlanPage["raster"]> {
  const page = (await store.getPage(ref))!;
  const base = page.getViewport({ scale: 1, rotation: 0 });
  let scale = 200 / 72;
  if (base.width * base.height * scale * scale > RASTER_MAX_PIXELS) {
    scale = Math.sqrt(RASTER_MAX_PIXELS / (base.width * base.height));
  }
  const vp = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  await page.render({ canvas, canvasContext: ctx, viewport: vp, background: "white" } as Parameters<
    typeof page.render
  >[0]).promise;
  ctx.setTransform(...(vp.transform as [number, number, number, number, number, number]));
  ctx.fillStyle = "#000";
  for (const a of redactions) {
    if (!("box" in a)) continue;
    ctx.save();
    ctx.translate(a.box.x, a.box.y);
    ctx.rotate((a.box.rot * Math.PI) / 180);
    ctx.fillRect(0, 0, a.box.w, a.box.h);
    ctx.restore();
  }
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.9));
  canvas.width = canvas.height = 0;
  page.cleanup();
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    view: page.view.slice(),
    rotate: page.rotate,
  };
}

/** Render a text box with system fonts (full Unicode + complex scripts like Thai). */
async function renderTextPng(a: Extract<Annotation, { type: "text" }>): Promise<Uint8Array> {
  const k = 4; // 4 px per point = 288 dpi
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(a.box.w * k));
  canvas.height = Math.max(1, Math.ceil(a.box.h * k));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(k, k);
  ctx.fillStyle = a.color;
  ctx.font = `${a.fontSize}px ${TEXT_FONTS}`;
  ctx.textBaseline = "alphabetic";
  for (const l of textLines(a)) ctx.fillText(l.text, 2, l.baseline + 2);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

