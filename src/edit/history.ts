import type { EditState } from "./model";

/**
 * Undo/redo over immutable snapshots. Because state updates share structure
 * (unchanged arrays/objects are reused), each snapshot costs only what
 * changed - not a copy of the document. Contrast with editors that keep a
 * full serialized PDF per undo step and run out of memory on big files.
 */
export class History {
  externalUndo?: {canUndo:()=>boolean;canRedo:()=>boolean;undo:()=>void;redo:()=>void};
  private past: EditState[] = [];
  private future: EditState[] = [];
  private listeners = new Set<(s: EditState) => void>();
  private savedState: EditState;

  constructor(
    private current: EditState,
    private limit = 200,
  ) {
    this.savedState = current;
  }

  get state(): EditState {
    return this.current;
  }

  get canUndo(): boolean {
    return this.externalUndo ? this.externalUndo.canUndo() : this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.externalUndo ? this.externalUndo.canRedo() : this.future.length > 0;
  }

  get dirty(): boolean {
    return this.current !== this.savedState;
  }

  markSaved(): void {
    this.savedState = this.current;
    this.emit();
  }

  /** Back to the last saved state, as one step that Undo can take back. */
  revert(): void {
    this.push(this.savedState);
  }

  /** Apply a change. No-op updates (same reference) are ignored. */
  push(next: EditState): void {
    if (next === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    this.emit();
  }

  /** Replace current state without creating an undo step (e.g. live drag). */
  replace(next: EditState): void {
    this.current = next;
    this.emit();
  }

  undo(): void {
    if (this.externalUndo) return this.externalUndo.undo();
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.current);
    this.current = prev;
    this.emit();
  }

  redo(): void {
    if (this.externalUndo) return this.externalUndo.redo();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.current);
    this.current = next;
    this.emit();
  }

  reset(state: EditState): void {
    this.past = [];
    this.future = [];
    this.current = state;
    this.savedState = state;
    this.emit();
  }

  subscribe(fn: (s: EditState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current);
  }
}
