import { FileSource, type PdfSource } from "../core/source";

/**
 * Platform bridge. The same web UI runs:
 *   - in Tauri on Windows (WebView2): native open/save dialogs, files read by
 *     byte range through Rust (no size limit), atomic in-place saves;
 *   - in Tauri on iOS/iPadOS (WKWebView): system document picker, saves into
 *     the app's Documents folder (visible in the Files app);
 *   - in any modern browser (development, PWA fallback).
 */
export type PlatformKind = "web" | "desktop" | "ios";

type Invoke = <T>(cmd: string, args?: unknown, opts?: { headers?: Record<string, string> }) => Promise<T>;

export interface SaveResult {
  name: string;
  path?: string;
  /** The currently open source file was overwritten. */
  inPlace: boolean;
}

/** A folder picked for folder search: its PDFs (in subfolders too). */
export interface PickedFolder {
  label: string;
  /** Native path (desktop), to reopen it next time. */
  path?: string;
  sources: PdfSource[];
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let invokeFn: Invoke | null = null;
async function invoke<T>(cmd: string, args?: unknown, opts?: { headers?: Record<string, string> }): Promise<T> {
  if (!invokeFn) invokeFn = (await import("@tauri-apps/api/core")).invoke as Invoke;
  return invokeFn<T>(cmd, args, opts);
}

/** File on the native file system, read lazily by byte range via Rust. */
export class NativeSource implements PdfSource {
  readonly freshReadAll = true;
  constructor(
    readonly path: string,
    readonly size: number,
    readonly modified: number,
  ) {}
  get name(): string {
    return this.path.split(/[\\/]/).pop() || "document.pdf";
  }
  static async open(path: string): Promise<NativeSource> {
    const [size, modified] = await invoke<[number, number]>("file_info", { path });
    return new NativeSource(path, size, modified);
  }
  async readRange(begin: number, end: number): Promise<Uint8Array> {
    const buf = await invoke<ArrayBuffer>("read_range", { path: this.path, offset: begin, length: end - begin });
    return new Uint8Array(buf);
  }
  async readAll(): Promise<Uint8Array> {
    return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path: this.path }));
  }
}

export class Platform {
  readonly kind: PlatformKind;

  constructor(isIOS: boolean) {
    this.kind = !isTauri ? "web" : isIOS ? "ios" : "desktop";
  }

  /** Files passed on the command line / "Open with" (Windows). */
  async initialFiles(): Promise<PdfSource[]> {
    if (this.kind !== "desktop") return [];
    try {
      const paths = await invoke<string[]>("initial_files");
      return Promise.all(paths.map((p) => NativeSource.open(p)));
    } catch {
      return [];
    }
  }

  async pickFiles(multiple = false): Promise<PdfSource[]> {
    if (this.kind === "desktop") {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const res = await open({ multiple, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!res) return [];
      const paths = Array.isArray(res) ? res : [res];
      return Promise.all(paths.map((p) => NativeSource.open(String(p))));
    }
    // iOS document picker / browser file chooser. Files are read lazily via
    // File.slice(), so even huge files aren't loaded into memory.
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      input.multiple = multiple;
      input.style.display = "none";
      input.addEventListener("change", () => {
        resolve([...(input.files ?? [])].map((f) => new FileSource(f)));
        input.remove();
      });
      input.addEventListener("cancel", () => {
        resolve([]);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /** Choose a folder; returns every PDF in it and its subfolders. */
  async pickFolder(): Promise<PickedFolder | null> {
    if (this.kind === "desktop") {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true });
      if (!dir || Array.isArray(dir)) return null;
      return this.listFolder(String(dir));
    }
    // Browser / iOS: a folder chooser hands over the files directly.
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.setAttribute("webkitdirectory", "");
      input.style.display = "none";
      input.addEventListener("change", () => {
        const files = [...(input.files ?? [])].filter((f) => /\.pdf$/i.test(f.name));
        const label = (input.files?.[0] as (File & { webkitRelativePath?: string }) | undefined)?.webkitRelativePath?.split("/")[0] ?? "Folder";
        files.sort((a, b) => ((a as File & { webkitRelativePath: string }).webkitRelativePath ?? a.name).localeCompare((b as File & { webkitRelativePath: string }).webkitRelativePath ?? b.name));
        resolve({ label, sources: files.map((f) => new FileSource(f)) });
        input.remove();
      });
      input.addEventListener("cancel", () => {
        resolve(null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /** The PDFs of a folder on disk (desktop). */
  async listFolder(path: string): Promise<PickedFolder> {
    const list = await invoke<{ path: string; size: number; modified: number }[]>("list_pdfs", { dir: path });
    return { label: path, path, sources: list.map((e) => new NativeSource(e.path, e.size, e.modified)) };
  }

  async pickImage(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/heic,image/*";
      input.style.display = "none";
      input.addEventListener("change", () => {
        resolve(input.files?.[0] ?? null);
        input.remove();
      });
      input.addEventListener("cancel", () => {
        resolve(null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /** Save; overwrites `current` in place when possible (desktop only). */
  async save(bytes: Uint8Array, name: string, current?: PdfSource, forceDialog = false): Promise<SaveResult | null> {
    if (this.kind === "desktop") {
      let path = !forceDialog ? current?.path : undefined;
      if (!path) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const chosen = await save({ defaultPath: name, filters: [{ name: "PDF", extensions: ["pdf"] }] });
        if (!chosen) return null;
        path = chosen.toLowerCase().endsWith(".pdf") ? chosen : chosen + ".pdf";
      }
      await invoke("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
      return { name: path.split(/[\\/]/).pop()!, path, inPlace: path === current?.path };
    }
    if (this.kind === "ios") {
      const path = await invoke<string>("save_to_documents", bytes, { headers: { name: encodeURIComponent(name) } });
      return { name: path.split("/").pop()!, path, inPlace: false };
    }
    return this.saveInBrowser(bytes, name);
  }

  /**
   * Save several new files (split parts, page images). Desktop: the user
   * picks a folder once; nothing there is overwritten ("x (1).pdf").
   * Browser: one download each. Returns how many were saved and where, or
   * null if cancelled.
   */
  async saveMany(
    files: AsyncIterable<{ name: string; bytes: Uint8Array; mime: string }>,
    defaultFolder?: string,
  ): Promise<{ count: number; folder?: string } | null> {
    if (this.kind === "desktop") {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, defaultPath: defaultFolder, title: "Choose a folder for the files" });
      if (!dir || Array.isArray(dir)) return null;
      let count = 0;
      for await (const f of files) {
        await invoke("write_new_file", f.bytes, { headers: { dir: encodeURIComponent(String(dir)), name: encodeURIComponent(f.name) } });
        count++;
      }
      return { count, folder: String(dir) };
    }
    let count = 0;
    for await (const f of files) {
      if (this.kind === "ios") await invoke<string>("save_to_documents", f.bytes, { headers: { name: encodeURIComponent(f.name) } });
      else {
        const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        // Browsers drop downloads started in the same instant.
        await new Promise((r) => setTimeout(r, 120));
      }
      count++;
    }
    return { count };
  }

  private async saveInBrowser(bytes: Uint8Array, name: string): Promise<SaveResult | null> {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> })
      .showSaveFilePicker;
    if (picker && !navigator.webdriver) {
      try {
        const handle = await picker({
          suggestedName: name,
          types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return { name: handle.name, inPlace: false };
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { name, inPlace: false };
  }

  async openExternal(url: string): Promise<void> {
    if (!/^(https?|mailto):/i.test(url)) return; // never open file:/javascript: from a PDF
    if (isTauri) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}
