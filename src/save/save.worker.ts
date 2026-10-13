/// <reference lib="webworker" />
import { applyEdits, type SavePlan } from "./applyEdits";

self.onmessage = async (e: MessageEvent<SavePlan>) => {
  try {
    const bytes = await applyEdits(e.data, (done, total) => self.postMessage({ type: "progress", done, total }));
    self.postMessage({ type: "done", bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error)?.message ?? String(err), name: (err as Error)?.name });
  }
};
