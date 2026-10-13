import { openForReading } from "../core/documents";
import type { PdfSource } from "../core/source";
import type { Platform, PickedFolder } from "../platform/platform";
import { FolderSearch, type FolderSearchState } from "./folderSearch";
import { indexedTextIndex } from "./textIndex";

const FOLDER_KEY = "pdfstudio:folder";

/**
 * Sidebar "Folder" tab: pick a folder, type once, see every matching page in
 * every PDF; click a result to open that file at that page with the word
 * highlighted. Works with no document open.
 */
export class FolderPanel {
  onOpen: (source: PdfSource, pageIndex: number, query: string) => void = () => {};
  private folder: PickedFolder | null = null;
  private search = new FolderSearch({
    open: openForReading,
    index: indexedTextIndex,
    // Each file is read in its own worker thread: use a few cores, not all.
    parallel: Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 4))),
  });
  private timer = 0;
  private restored = false;
  private q: HTMLInputElement;
  private cs: HTMLInputElement;
  private status: HTMLElement;
  private list: HTMLUListElement;
  private name: HTMLElement;
  private empty: HTMLElement;

  constructor(
    root: HTMLElement,
    private platform: Platform,
  ) {
    const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.q = $("#folder-query");
    this.cs = $("#folder-case");
    this.status = $("#folder-status");
    this.list = $("#folder-results");
    this.name = $("#folder-name");
    this.empty = $("#folder-empty");
    $("[data-folder-act=pick]").addEventListener("click", () => void this.pick());
    this.q.addEventListener("input", () => this.schedule(350));
    this.q.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.schedule(0);
      if (e.key === "Escape") this.q.blur();
    });
    this.cs.addEventListener("change", () => this.schedule(0));
    this.search.onUpdate = (s) => this.render(s);
  }

  /** Shown: reopen the last folder (desktop) and focus the box. */
  async show(): Promise<void> {
    if (!this.restored) {
      this.restored = true;
      const last = localStorage.getItem(FOLDER_KEY);
      if (last && this.platform.kind === "desktop") {
        try {
          this.setFolder(await this.platform.listFolder(last));
        } catch {
          /* folder moved or deleted */
        }
      }
    }
    this.q.focus();
    this.q.select();
  }

  private async pick(): Promise<void> {
    const f = await this.platform.pickFolder();
    if (!f) return;
    this.setFolder(f);
    if (f.path) localStorage.setItem(FOLDER_KEY, f.path);
    this.q.focus();
    this.schedule(0);
  }

  private setFolder(f: PickedFolder): void {
    this.folder = f;
    this.name.textContent = `${f.label} · ${f.sources.length} PDF${f.sources.length === 1 ? "" : "s"}`;
    this.name.title = f.label;
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), ms);
  }

  private async run(): Promise<void> {
    const query = this.q.value;
    if (!this.folder) {
      this.status.textContent = query.trim() ? "Choose a folder first." : "";
      return;
    }
    if (!query.trim()) {
      this.search.cancel();
      this.list.replaceChildren();
      this.status.textContent = "";
      this.empty.hidden = false;
      return;
    }
    this.empty.hidden = true;
    await this.search.run(this.folder.sources, query, this.cs.checked);
  }

  private display(source: PdfSource): string {
    const base = this.folder?.path;
    if (source.path && base && source.path.startsWith(base)) return source.path.slice(base.length).replace(/^[\\/]+/, "");
    return source.name;
  }

  private render(s: FolderSearchState): void {
    const query = this.q.value;
    const matches = s.results.reduce((n, f) => n + f.hits.reduce((m, h) => m + h.count, 0), 0);
    const notes: string[] = [];
    if (s.noText.length) notes.push(`${s.noText.length} file${s.noText.length === 1 ? " has" : "s have"} no text (scans: needs OCR)`);
    if (s.locked.length) notes.push(`${s.locked.length} locked with a password`);
    if (s.failed.length) notes.push(`${s.failed.length} could not be read`);
    this.status.textContent = s.done
      ? `${matches ? `${matches} match${matches === 1 ? "" : "es"} in ${s.results.length} of ${s.total} files` : "No matches"}${notes.length ? ". " + notes.join(", ") + "." : ""}`
      : `Searching… ${s.scanned} of ${s.total} files${matches ? ` · ${matches} found` : ""}`;
    // PDF text is untrusted: build nodes with textContent only.
    const items = s.results.map((f) => {
      const li = document.createElement("li");
      li.className = "folder-file";
      const head = document.createElement("div");
      head.className = "folder-file-name";
      head.textContent = this.display(f.source);
      head.title = f.source.path ?? f.source.name;
      const n = document.createElement("span");
      n.className = "muted";
      n.textContent = ` ${f.hits.reduce((m, h) => m + h.count, 0)}`;
      head.appendChild(n);
      li.appendChild(head);
      for (const h of f.hits) {
        const b = document.createElement("button");
        b.className = "folder-hit";
        const page = document.createElement("span");
        page.className = "folder-hit-page";
        page.textContent = `p. ${h.pageIndex + 1}`;
        const snip = document.createElement("span");
        snip.className = "folder-hit-text";
        const mark = document.createElement("mark");
        mark.textContent = h.match;
        snip.append(h.before, mark, h.after);
        b.append(page, snip);
        b.addEventListener("click", () => this.onOpen(f.source, h.pageIndex, query));
        li.appendChild(b);
      }
      return li;
    });
    this.list.replaceChildren(...items);
  }
}
