/**
 * Shared engine cache — one ConversationEngine per character.
 *
 * IMPORTANT: Stored on `globalThis` so it survives across webpack-bundled
 * route entry points (same rationale as schedulerCache). Each engine holds
 * SQLite connections, so we cap the cache at MAX_ENGINES and evict the
 * oldest (LRU) entry when full, calling cleanup() if available.
 */

const MAX_ENGINES = 10;

interface EngineEntry {
  engine: any;
  lastUsed: number;
}

const CACHE_KEY = "__opencrush_engineCache";

declare global {
  // eslint-disable-next-line no-var
  var __opencrush_engineCache: Map<string, EngineEntry> | undefined;
}

if (!globalThis[CACHE_KEY as keyof typeof globalThis]) {
  (globalThis as Record<string, unknown>)[CACHE_KEY] = new Map<string, EngineEntry>();
}

const internalCache = (globalThis as Record<string, unknown>)[
  CACHE_KEY
] as Map<string, EngineEntry>;

/**
 * Evict the least-recently-used engine when cache exceeds MAX_ENGINES.
 * Calls engine.cleanup() / engine.close() if the engine exposes one.
 */
function evictIfNeeded(): void {
  while (internalCache.size > MAX_ENGINES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of internalCache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (!oldestKey) break;

    const evicted = internalCache.get(oldestKey);
    internalCache.delete(oldestKey);

    // Clean up SQLite connections if the engine supports it
    if (evicted?.engine) {
      try {
        if (typeof evicted.engine.cleanup === "function") {
          evicted.engine.cleanup();
        } else if (typeof evicted.engine.close === "function") {
          evicted.engine.close();
        }
      } catch (err) {
        console.warn(`[engine-cache] Failed to cleanup evicted engine "${oldestKey}":`, err);
      }
    }

    console.log(`[engine-cache] Evicted LRU engine: "${oldestKey}" (cache size: ${internalCache.size})`);
  }
}

/**
 * Public API — a Map-like interface with LRU eviction.
 *
 * get() updates lastUsed so frequently accessed engines stay cached.
 * set() triggers eviction when cache exceeds MAX_ENGINES.
 */
export const engineCache = {
  get(key: string): any | undefined {
    const entry = internalCache.get(key);
    if (!entry) return undefined;
    // Touch — mark as recently used
    entry.lastUsed = Date.now();
    return entry.engine;
  },

  set(key: string, engine: any): void {
    internalCache.set(key, { engine, lastUsed: Date.now() });
    evictIfNeeded();
  },

  has(key: string): boolean {
    return internalCache.has(key);
  },

  delete(key: string): boolean {
    const entry = internalCache.get(key);
    if (entry?.engine) {
      try {
        if (typeof entry.engine.cleanup === "function") {
          entry.engine.cleanup();
        } else if (typeof entry.engine.close === "function") {
          entry.engine.close();
        }
      } catch { /* best effort */ }
    }
    return internalCache.delete(key);
  },

  get size(): number {
    return internalCache.size;
  },

  clear(): void {
    for (const [key] of internalCache) {
      this.delete(key);
    }
  },
};
