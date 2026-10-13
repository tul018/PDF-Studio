import { uid, type PageRef } from "./model";

/**
 * Position marks ("bookmarks" for the reader, not PDF outline entries):
 * mark the current spot, name it, and jump back with one click. Stored per
 * file (name + size) so they're still there next time you open it.
 */
export interface Mark {
  id: string;
  label: string;
  /** Page in the original document (stable across sessions). */
  srcIndex: number;
  /** Vertical position inside the page, 0..1. */
  fy: number;
  color: string;
  created: number;
}

export const MARK_COLORS = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa"];

export class Marks {
  private list: Mark[] = [];
  private key = "";
  onChange: () => void = () => {};

  load(fileKey: string): void {
    this.key = `pdfstudio:marks:${fileKey}`;
    try {
      this.list = JSON.parse(localStorage.getItem(this.key) ?? "[]");
      if (!Array.isArray(this.list)) this.list = [];
    } catch {
      this.list = [];
    }
    this.onChange();
  }

  clear(): void {
    this.key = "";
    this.list = [];
    this.onChange();
  }

  get all(): readonly Mark[] {
    return this.list;
  }

  add(srcIndex: number, fy: number, label: string): Mark {
    const m: Mark = {
      id: uid("m"),
      label,
      srcIndex,
      fy,
      color: MARK_COLORS[this.list.length % MARK_COLORS.length],
      created: Date.now(),
    };
    this.list = [...this.list, m].sort((a, b) => a.srcIndex - b.srcIndex || a.fy - b.fy);
    this.persist();
    return m;
  }

  update(id: string, patch: Partial<Pick<Mark, "label" | "color">>): void {
    this.list = this.list.map((m) => (m.id === id ? { ...m, ...patch } : m));
    this.persist();
  }

  remove(id: string): void {
    this.list = this.list.filter((m) => m.id !== id);
    this.persist();
  }

  /** Marks on a given source page (for the page ribbon). */
  onPage(srcIndex: number): Mark[] {
    return this.list.filter((m) => m.srcIndex === srcIndex);
  }

  /** Where a mark currently is in the (possibly reordered) page list. */
  static locate(m: Mark, pages: readonly PageRef[], mainDocId: string): number {
    return pages.findIndex((p) => p.docId === mainDocId && p.srcIndex === m.srcIndex);
  }

  private persist(): void {
    if (this.key) {
      try {
        localStorage.setItem(this.key, JSON.stringify(this.list));
      } catch {
        /* storage full / private mode: marks stay in memory */
      }
    }
    this.onChange();
  }
}
