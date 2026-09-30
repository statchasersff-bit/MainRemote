/**
 * A bounded map that evicts the least recently used entry.
 *
 * The render caches used to evict the oldest INSERTED entry, so a crawler
 * walking every page pushed out the pages readers actually hit. Here a read
 * moves the entry to the back, and a crawl only displaces what nobody is
 * asking for. A Map keeps insertion order, which is all this needs.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, value);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
