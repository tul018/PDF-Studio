/// <reference lib="webworker" />
import { shrinkPdf, type ShrinkLevel } from "./shrink";

self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array; level: ShrinkLevel }>) => {
  try {
    const r = await shrinkPdf(e.data.bytes, e.data.level, (f) => self.postMessage({ type: "progress", f }));
    self.postMessage({ type: "done", ...r }, [r.bytes.buffer as ArrayBuffer]);
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error)?.message ?? String(err) });
  }
};
