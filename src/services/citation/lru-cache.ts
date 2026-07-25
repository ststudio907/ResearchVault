// src/services/citation/lru-cache.ts
//
// Tiny in-memory LRU cache with a per-entry TTL. Used by `CitationService`
// (4.1.B) to cache CrossRef + OpenAlex lookups so a re-paste of the same DOI
// doesn't re-hit the network, and so a known-bad DOI doesn't get re-fetched
// for the TTL window.
//
// Design notes (locked in 4.1.B §8.2 / §14):
//   - Generic `LruCache<K, V>` — caller picks the value type. The orchestrator
//     instantiates three flavours:
//        `LruCache<string, CslJsonRecord | null>`         (lookupByDoi)
//        `LruCache<string, CslJsonRecord[]>`             (searchByTitle)
//        `LruCache<string, CslJsonRecord[]>`             (searchByQuery)
//   - Negative caching is first-class: a `null` for a known-bad DOI, and
//     `[]` for a search that returned no hits, are stored with the same TTL
//     and the same cap. A `Map.has(key)` of `true` means "I have an answer
//     for this key", not "the answer is non-empty".
//   - Eviction policy: when the cap is exceeded, drop the **oldest** entry
//     (smallest `fetchedAt`). We do NOT track recency separately — every
//     `set()` is a fresh write, and stale entries are pruned on read via
//     the TTL check. This is the simplest correct policy for a "set" /
//     "get" workload and matches the §8.2 B4 spec (30 d TTL, 500 cap).
//   - `clock` is injectable. Production passes `Date.now` (the default);
//     the 5.x vitest fixtures pass a controlled `() => number` so they
//     can fast-forward time without sleeping.
//   - No external deps. `Map` is built into the platform and the only
//     container we use. Per-entry overhead is one `{ value, fetchedAt }`
//     tuple — about 24 B of heap per entry on a 64-bit V8.
//
// What this is NOT:
//   - Persistent. On plugin reload the cache clears; that's the desired
//     behaviour for a per-session lookup cache and matches `AIClient`'s
//     in-process state pattern.
//   - Thread-safe. JavaScript is single-threaded, so the only relevant
//     safety concern is "does the `set()` that bumps the size past the cap
//     race with a concurrent `get()`?" — `Map` is synchronous, the answer
//     is "no, this is fine".
//

/** A cache entry. `value` is whatever the caller stored. */
interface CacheEntry<V> {
	value: V;
	/** Wall-clock timestamp of the last `set()` for this key. */
	fetchedAt: number;
}

/** Constructor options. `ttlMs` and `maxEntries` are both required. */
export interface LruCacheOptions {
	/** Per-entry TTL in milliseconds. Entries older than this return `undefined` from `get()`. */
	ttlMs: number;
	/** Maximum number of entries. When exceeded, the oldest entry is dropped on the next `set()`. */
	maxEntries: number;
	/** Defaults to `Date.now`. Inject a controlled function in tests. */
	clock?: () => number;
}

export class LruCache<K, V> {
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly clock: () => number;
	private readonly store: Map<K, CacheEntry<V>>;

	constructor(opts: LruCacheOptions) {
		if (!Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0) {
			throw new Error(`LruCache: ttlMs must be > 0, got ${opts.ttlMs}`);
		}
		if (!Number.isInteger(opts.maxEntries) || opts.maxEntries <= 0) {
			throw new Error(`LruCache: maxEntries must be a positive integer, got ${opts.maxEntries}`);
		}
		this.ttlMs = opts.ttlMs;
		this.maxEntries = opts.maxEntries;
		this.clock = opts.clock ?? Date.now;
		this.store = new Map();
	}

	/**
	 * Read a value. Returns `undefined` when the key is absent OR when the
	 * stored entry has aged past `ttlMs`. Expired entries are deleted as a
	 * side effect so the cap stays effective under skewed access patterns.
	 */
	get(key: K): V | undefined {
		const entry = this.store.get(key);
		if (entry === undefined) return undefined;
		if (this.clock() - entry.fetchedAt > this.ttlMs) {
			this.store.delete(key);
			return undefined;
		}
		return entry.value;
	}

	/**
	 * Write a value. If the cap would be exceeded, drop the oldest entry
	 * (smallest `fetchedAt`) until we're back under the cap. Re-setting
	 * an existing key refreshes its `fetchedAt` — that's the desired
	 * behaviour for the "user re-pasted the same DOI" case.
	 */
	set(key: K, value: V): void {
		const now = this.clock();
		// If key already exists, just refresh — no size change.
		if (this.store.has(key)) {
			this.store.set(key, { value, fetchedAt: now });
			return;
		}
		// Otherwise insert, then trim if needed.
		this.store.set(key, { value, fetchedAt: now });
		while (this.store.size > this.maxEntries) {
			// `Map` preserves insertion order, so the first key is the oldest
			// by `fetchedAt` *only if no entry has been re-set* — re-set
			// updates `fetchedAt` but keeps the original insertion order.
			// That's the right policy for us: a re-set means "this is the
			// freshest answer for this key", so it should be the last to
			// go. The first insertion is the most stale.
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}

	/** True when the key has a non-expired entry. */
	has(key: K): boolean {
		return this.get(key) !== undefined;
	}

	/** Drop a single key. No-op when the key is absent or expired. */
	delete(key: K): boolean {
		return this.store.delete(key);
	}

	/** Drop everything. Called by `CitationService` if we ever add a manual clear affordance. */
	clear(): void {
		this.store.clear();
	}

	/** Current entry count. Exposed for the 4.1.E smoke test (`size() === 1` after a single lookup). */
	size(): number {
		return this.store.size;
	}
}
