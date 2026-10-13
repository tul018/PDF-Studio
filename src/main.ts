import "./styles.css";
import { App } from "./app";
import { toast } from "./ui/dialogs";

// Last-resort guards: report problems instead of leaving a dead window.
window.addEventListener("error", (e) => {
  if (/ResizeObserver loop/.test(e.message)) return; // benign browser notice
  console.error(e.error ?? e.message);
  toast(`Unexpected error: ${e.message}`, "error", 6000);
});
window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason as Error | undefined;
  if (err?.name === "AbortError" || err?.name === "RenderingCancelledException") return;
  console.error(err);
  toast(`Unexpected error: ${err?.message ?? err}`, "error", 6000);
});

const app = new App();
(window as unknown as { app: App }).app = app;
