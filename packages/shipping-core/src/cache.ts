/**
 * Minimal async cache. A provider can pass an adapter over Medusa's Caching
 * Module (`Modules.CACHING`); without one, MemoryTtlCache is used.
 */
export interface ShippingCache {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
}

type Entry = { value: unknown; expires: number }

/** In-process TTL cache with a size cap (oldest entries evicted first). */
export class MemoryTtlCache implements ShippingCache {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly maxEntries = 1000,
    private readonly now: () => number = Date.now
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key)
    if (!entry) {
      return undefined
    }
    if (entry.expires <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value as T
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.delete(key)
    this.entries.set(key, { value, expires: this.now() + ttlSeconds * 1000 })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
  }
}
