/// <reference lib="webworker" />
import { splitPdf } from "./split";

/** Splitting runs off the main thread: the window stays responsive on big files. */
self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array; parts: number[][] }>) => {
  try {
    const out = await splitPdf(e.data.bytes, e.data.parts, (done) => self.postMessage({ type: "progress", done }));
    self.postMessage(
      { type: "done", parts: out },
      out.map((b) => b.buffer as ArrayBuffer),
    );
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error)?.message ?? String(err) });
  }
};
