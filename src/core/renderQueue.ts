/**
 * Priority render scheduler.
 *
 * - Bounded concurrency: never more than N renders in flight, so a fast
 *   scroll through 1 000 pages doesn't start 1 000 renders.
 * - Re-prioritisable: the page closest to the viewport always goes next.
 * - Cancellable: tasks for pages that left the viewport are dropped before
 *   they allocate anything.
 */
export interface RenderTask {
  key: string;
  priority: number; // lower = sooner
  run: (signal: AbortSignal) => Promise<void>;
}

interface Entry extends RenderTask {
  controller: AbortController;
  running: boolean;
}

export class RenderQueue {
  private pending = new Map<string, Entry>();
  private running = new Map<string, Entry>();
  private idleWaiters: Array<() => void> = [];

  constructor(public concurrency = 2) {}

  /** Add or re-prioritise a task. Returns false if it is already running. */
  schedule(task: RenderTask): boolean {
    if (this.running.has(task.key)) return false;
    const existing = this.pending.get(task.key);
    if (existing) {
      existing.priority = task.priority;
      existing.run = task.run;
    } else {
      this.pending.set(task.key, { ...task, controller: new AbortController(), running: false });
    }
    queueMicrotask(() => this.pump());
    return true;
  }

  has(key: string): boolean {
    return this.pending.has(key) || this.running.has(key);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  cancel(key: string): void {
    const p = this.pending.get(key);
    if (p) {
      p.controller.abort();
      this.pending.delete(key);
    }
    const r = this.running.get(key);
    if (r) r.controller.abort();
  }

  /** Cancel everything whose key is not in `keep`. */
  retain(keep: (key: string) => boolean): void {
    for (const key of [...this.pending.keys(), ...this.running.keys()]) {
      if (!keep(key)) this.cancel(key);
    }
  }

  cancelAll(): void {
    this.retain(() => false);
  }

  get size(): number {
    return this.pending.size + this.running.size;
  }

  get idle(): boolean {
    return this.size === 0;
  }

  whenIdle(): Promise<void> {
    if (this.idle) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.size > 0) {
      let best: Entry | null = null;
      for (const e of this.pending.values()) if (!best || e.priority < best.priority) best = e;
      if (!best) break;
      this.pending.delete(best.key);
      best.running = true;
      this.running.set(best.key, best);
      const entry = best;
      entry
        .run(entry.controller.signal)
        .catch((err) => {
          if (!isAbort(err)) console.warn(`render task ${entry.key} failed`, err);
        })
        .finally(() => {
          if (this.running.get(entry.key) === entry) this.running.delete(entry.key);
          if (this.idle) {
            const w = this.idleWaiters;
            this.idleWaiters = [];
            w.forEach((f) => f());
          }
          this.pump();
        });
    }
  }
}

export function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "RenderingCancelledException";
}
