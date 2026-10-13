import { getDocument } from "pdfjs-dist";
import { CSS_UNITS } from "../core/documents";

/**
 * Print the *edited* document: the same bytes that Save would write are
 * rendered one page at a time into compressed JPEGs (150 dpi), so even a
 * 500-page job never holds more than one full-size bitmap in memory.
 */
export async function printPdf(bytes: Uint8Array, onProgress: (f: number) => void, signal: AbortSignal): Promise<void> {
  const task = getDocument({ data: bytes });
  const doc = await task.promise;
  const root = document.createElement("div");
  root.id = "print-root";
  const urls: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (signal.aborted) return;
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 150 / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, viewport: vp, background: "white" } as Parameters<typeof page.render>[0]).promise;
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.92));
      canvas.width = canvas.height = 0;
      page.cleanup();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      const base = page.getViewport({ scale: 1 });
      img.style.aspectRatio = `${base.width} / ${base.height}`;
      img.dataset.landscape = String(base.width > base.height);
      img.width = Math.round(base.width * CSS_UNITS);
      root.appendChild(img);
      onProgress(i / doc.numPages);
    }
    document.body.appendChild(root);
    await Promise.all([...root.querySelectorAll("img")].map((im) => im.decode().catch(() => {})));
    window.print();
  } finally {
    setTimeout(() => {
      root.remove();
      urls.forEach((u) => URL.revokeObjectURL(u));
    }, 1000);
    await task.destroy();
  }
}
