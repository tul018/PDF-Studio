import { getDocument } from "pdfjs-dist";
import { pdfjsAssets } from "../core/documents";
import SplitWorker from "./split.worker?worker";

/** Split the (edited) document into parts, in a worker. */
export function splitInWorker(bytes: Uint8Array, parts: number[][], onProgress: (f: number) => void): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const w = new SplitWorker();
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress") onProgress(m.done / Math.max(1, parts.length));
      else if (m.type === "done") {
        w.terminate();
        resolve(m.parts as Uint8Array[]);
      } else if (m.type === "error") {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "Split failed"));
    };
    w.postMessage({ bytes, parts }, [bytes.buffer as ArrayBuffer]);
  });
}

export interface ImageExport {
  format: "png" | "jpeg";
  dpi: number;
}

/**
 * Render pages of the (edited) document to images, one at a time (only one
 * full-size bitmap in memory), as they are consumed. Pixel size is capped so
 * a huge page at 300 dpi can't exhaust memory.
 */
export async function* pagesToImages(
  bytes: Uint8Array,
  pageIndices: readonly number[],
  o: ImageExport,
  onProgress: (f: number) => void,
): AsyncGenerator<{ index: number; blob: Blob }> {
  const task = getDocument({ data: bytes, ...pdfjsAssets } as Parameters<typeof getDocument>[0]);
  const doc = await task.promise;
  const MAX_PIXELS = 40e6;
  try {
    for (const [k, i] of pageIndices.entries()) {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      let scale = o.dpi / 72;
      if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(vp.width)); // round: 1650.0000001 must not become 1651
      canvas.height = Math.max(1, Math.round(vp.height));
      await page.render({ canvas, viewport: vp, background: "white" } as Parameters<typeof page.render>[0]).promise;
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), `image/${o.format}`, 0.92));
      canvas.width = canvas.height = 0;
      page.cleanup();
      yield { index: i, blob };
      onProgress((k + 1) / pageIndices.length);
    }
  } finally {
    await task.destroy();
  }
}
