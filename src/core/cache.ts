// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — In-Memory Cache with TTL
// ═══════════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

type CacheKey = string;

export class Cache {
  private store = new Map<CacheKey, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;
  private hitCount = 0;
  private missCount = 0;

  /** All live cache instances for health monitoring. */
  private static instances = new Set<Cache>();

  constructor(defaultTtlMs: number = 300_000) {
    this.defaultTtlMs = defaultTtlMs;
    Cache.instances.add(this);
  }

  /** Get a value. Returns undefined if missing or expired. */
  get<T>(key: CacheKey): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.missCount++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return undefined;
    }
    this.hitCount++;
    return entry.value;
  }

  /** Set a value with optional TTL override. */
  set<T>(key: CacheKey, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /** Delete a key. */
  delete(key: CacheKey): void {
    this.store.delete(key);
  }

  /** Check if key exists and is fresh. */
  has(key: CacheKey): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      this.missCount++;
      return false;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return false;
    }
    this.hitCount++;
    return true;
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Get cache stats (purges expired entries first). */
  stats(): { size: number; keys: string[] } {
    // Purge expired first
    for (const key of Array.from(this.store.keys())) {
      const entry = this.store.get(key);
      if (entry && Date.now() > entry.expiresAt) this.store.delete(key);
    }
    return { size: this.store.size, keys: Array.from(this.store.keys()) };
  }

  /**
   * Health-oriented stats: entries, hit rate, TTL config, and rough memory estimate.
   * Purges expired entries before counting.
   */
  healthStats(): { entries: number; hitRate: number; ttlConfig: { defaultTtlMs: number }; memoryEstimate: number } {
    // Purge expired first
    for (const key of Array.from(this.store.keys())) {
      const entry = this.store.get(key);
      if (entry && Date.now() > entry.expiresAt) this.store.delete(key);
    }
    const total = this.hitCount + this.missCount;
    const hitRate = total > 0 ? Math.round((this.hitCount / total) * 10000) / 100 : 0;
    return {
      entries: this.store.size,
      hitRate,
      ttlConfig: { defaultTtlMs: this.defaultTtlMs },
      memoryEstimate: this.store.size * 512, // rough estimate per entry
    };
  }

  /** Get health stats from all registered cache instances. */
  static getAllHealthStats(): ReturnType<Cache['healthStats']>[] {
    return Array.from(Cache.instances).map(c => c.healthStats());
  }

  /** Memoize an async function with cache key based on args. */
  memoize<T>(
    fn: (...args: unknown[]) => Promise<T>,
    keyFn?: (...args: unknown[]) => string,
    ttlMs?: number,
  ): (...args: unknown[]) => Promise<T> {
    return async (...args: unknown[]): Promise<T> => {
      const key = keyFn ? keyFn(...args) : JSON.stringify(args);
      const cached = this.get<T>(key);
      if (cached !== undefined) return cached;
      const result = await fn(...args);
      this.set(key, result, ttlMs);
      return result;
    };
  }
}

// ── Global cache singleton ──

let _globalCache: Cache | undefined;

/**
 * Get the shared global cache instance.
 * Lazily created on first call with the default 300s TTL.
 */
export function getGlobalCache(): Cache {
  if (!_globalCache) {
    _globalCache = new Cache();
  }
  return _globalCache;
}

/**
 * Reset the global cache singleton (for testing).
 */
export function resetGlobalCache(): void {
  _globalCache = undefined;
}
