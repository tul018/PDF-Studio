/** Tiny LRU keyed cache with a weight budget (e.g. pixels or bytes). */
export class WeightedLRU<V> {
  private map = new Map<string, { value: V; weight: number }>();
  private total = 0;

  constructor(
    public budget: number,
    private onEvict: (key: string, value: V) => void = () => {},
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }

  set(key: string, value: V, weight: number, pinned: (key: string) => boolean = () => false): void {
    this.delete(key);
    this.map.set(key, { value, weight });
    this.total += weight;
    this.trim(pinned);
  }

  delete(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.map.delete(key);
    this.total -= e.weight;
    this.onEvict(key, e.value);
    return true;
  }

  /** Evict least-recently-used entries until under budget; pinned survive. */
  trim(pinned: (key: string) => boolean = () => false): void {
    if (this.total <= this.budget) return;
    for (const key of [...this.map.keys()]) {
      if (this.total <= this.budget) break;
      if (!pinned(key)) this.delete(key);
    }
  }

  clear(): void {
    for (const key of [...this.map.keys()]) this.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  get weight(): number {
    return this.total;
  }

  get size(): number {
    return this.map.size;
  }
}
