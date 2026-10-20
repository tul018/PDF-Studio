import type { PdfSource } from "./core/source";
import type { EditState, StoredImage } from "./edit/model";

/**
 * Tabs: several open files. Only the active tab is loaded; the others keep a
 * small snapshot (their files, edits, images and reading position) and are
 * reopened from disk in a moment when switched to - memory stays flat no
 * matter how many tabs are open.
 */
export interface TabSnapshot {
  /** Edits with document ids replaced by "#0", "#1"... (index into Tab.sources). */
  state: EditState;
  images: Map<string, StoredImage>;
  dirty: boolean;
  view: { index: number; fy: number; zoom: number };
}

export interface Tab {
  id: string;
  /** Main file first, then files merged into it. */
  sources: PdfSource[];
  snapshot: TabSnapshot | null;
  /** Passwords typed for these files this session (never stored). */
  passwords: Map<string, string>;
}

let n = 0;
export const newTab = (sources: PdfSource[]): Tab => ({ id: `t${++n}`, sources, snapshot: null, passwords: new Map() });

/** Replace document ids in an edit state (for snapshots and restoring them). */
export function mapDocIds(s: EditState, map: (id: string) => string): EditState {
  return {
    pages: s.pages.map((p) => (p.docId ? { ...p, docId: map(p.docId) } : p)),
    annotations: s.annotations,
    formValues: Object.fromEntries(
      Object.entries(s.formValues).map(([k, v]) => {
        const i = k.indexOf("|");
        return [`${map(k.slice(0, i))}${k.slice(i)}`, v];
      }),
    ),
  };
}

export class TabBar {
  onSelect: (i: number) => void = () => {};
  onClose: (i: number) => void = () => {};
  onNew: () => void = () => {};

  constructor(private el: HTMLElement) {
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>("[data-tab-i]");
      if (t.closest("[data-tab-new]")) return this.onNew();
      if (!tab) return;
      const i = Number(tab.dataset.tabI);
      if (t.closest(".tab-close")) this.onClose(i);
      else this.onSelect(i);
    });
    // Middle-click closes, like a browser.
    el.addEventListener("auxclick", (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-tab-i]");
      if (tab && e.button === 1) this.onClose(Number(tab.dataset.tabI));
    });
  }

  render(tabs: readonly Tab[], active: number, activeDirty: boolean): void {
    // Shown from the first file on, so even a single file has its × (back to the start screen).
    document.body.classList.toggle("has-tabs", tabs.length > 0);
    const items = tabs.map((t, i) => {
      const b = document.createElement("div");
      b.className = "tab" + (i === active ? " active" : "");
      b.dataset.tabI = String(i);
      b.setAttribute("role", "tab");
      b.title = t.sources[0]?.path ?? t.sources[0]?.name ?? "";
      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = t.sources[0]?.name ?? "PDF";
      const dirty = i === active ? activeDirty : !!t.snapshot?.dirty;
      if (dirty) name.textContent = "● " + name.textContent;
      const x = document.createElement("button");
      x.className = "tab-close";
      x.textContent = "×";
      x.title = "Close tab";
      b.append(name, x);
      return b;
    });
    const plus = document.createElement("button");
    plus.className = "tab-new";
    plus.dataset.tabNew = "";
    plus.textContent = "+ Open";
    plus.title = "Open another file in a new tab (Ctrl+O)";
    this.el.replaceChildren(...items, plus);
  }
}

// ------------------------------------------------------------------ recent files

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}
const RECENT_KEY = "pdfstudio:recent";

export function recentFiles(): RecentFile[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Remember a file opened from disk (desktop: it can be reopened by path). */
export function rememberRecent(source: PdfSource): void {
  if (!source.path) return;
  const list = [{ path: source.path, name: source.name, openedAt: Date.now() }, ...recentFiles().filter((r) => r.path.toLowerCase() !== source.path!.toLowerCase())];
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 15)));
  } catch {
    /* ignore */
  }
}

export function forgetRecent(path: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentFiles().filter((r) => r.path !== path)));
  } catch {
    /* ignore */
  }
}
