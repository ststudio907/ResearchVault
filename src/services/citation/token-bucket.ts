// src/services/citation/token-bucket.ts
//
// Token-bucket rate limiter. Used by `CitationService` (4.1.B) to gate every
// outbound CrossRef / OpenAlex call behind a single shared budget so we stay
// inside both providers' polite pools.
//
// Design notes (locked in 4.1.B §8.2 / §14):
//   - Single shared bucket across both providers. B3: the polite pools don't
//     talk to each other but *our* budget does — if a user rapid-fires DOI
//     lookups and free-text searches in the same second, the bucket is the
//     one gate that knows the combined rate.
//   - `take()` is await-with-backoff, not a busy-loop. We schedule a single
//     `setTimeout` for the wait, return a `Promise`, and let the event loop
//     keep spinning for other work. The 4.1.A AI client uses the same
//     pattern, so the modal stays responsive while a queue of lookups
//     drains.
//   - `tryTake()` for non-blocking code paths. 4.1.B doesn't actually use
//     it — the cache-hit path skips the bucket entirely (B2 second half) —
//     but 5.x vitest fixtures want it for "did the bucket spend a token?"
//     assertions, and 4.1.C may want it for the "disable the button until
//     the bucket refills" affordance.
//   - `clock` is injectable, same as `LruCache`. Production passes
//     `Date.now`; tests pass a controlled function so they can advance
//     time without sleeping.
//   - No external deps. Just arithmetic, `setTimeout`, and a tiny queue of
//     pending resolvers.
//
// What this is NOT:
//   - Fair across multiple keys. It's a single-bucket rate limiter, not a
//     per-provider one. If we ever want a per-provider budget, we instantiate
//     two `TokenBucket`s — the public API is unchanged.
//   - Pre-emptive. A caller that arrives when the bucket is empty has to
//     wait. We do NOT silently drop requests. The whole point of the bucket
//     is to slow the caller down to a polite rate.
//

/** Constructor options. `rps` and `burst` are both required. */
export interface TokenBucketOptions {
	/** Refill rate, in tokens per second. The 4.1.B default is 5. */
	rps: number;
	/** Maximum number of tokens the bucket can hold. The 4.1.B default is 10. */
	burst: number;
	/** Defaults to `Date.now`. Inject a controlled function in tests. */
	clock?: () => number;
	/**
	 * Defaults to `setTimeout` from the global. Inject a controlled scheduler
	 * in tests so the suite can flush microtasks without sleeping.
	 */
	setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
	/** Defaults to `clearTimeout` from the global. Mirror of `setTimeoutImpl`. */
	clearTimeoutImpl?: (handle: unknown) => void;
}

/**
 * A pending wait — a single resolver paired with its scheduled timer. We
 * keep a list so `drain()` (used in tests) can flush the whole queue at once
 * without advancing the real clock.
 */
interface PendingWait {
	resolve: () => void;
	handle: unknown;
}

export class TokenBucket {
	private readonly rps: number;
	private readonly capacity: number;
	private readonly clock: () => number;
	private readonly setTimeoutImpl: (cb: () => void, ms: number) => unknown;
	private readonly clearTimeoutImpl: (handle: unknown) => void;

	private tokens: number;
	private lastRefill: number;
	private readonly pending: PendingWait[] = [];

	constructor(opts: TokenBucketOptions) {
		if (!Number.isFinite(opts.rps) || opts.rps <= 0) {
			throw new Error(`TokenBucket: rps must be > 0, got ${opts.rps}`);
		}
		if (!Number.isInteger(opts.burst) || opts.burst <= 0) {
			throw new Error(`TokenBucket: burst must be a positive integer, got ${opts.burst}`);
		}
		this.rps = opts.rps;
		this.capacity = opts.burst;
		this.clock = opts.clock ?? Date.now;
		this.setTimeoutImpl = opts.setTimeoutImpl ?? ((cb, ms) => window.setTimeout(cb, ms));
		this.clearTimeoutImpl =
			opts.clearTimeoutImpl ?? ((handle) => window.clearTimeout(handle as ReturnType<typeof window.setTimeout>));
		// Start full. A new bucket that has never been used should not block
		// the first burst of lookups the user triggered.
		this.tokens = this.capacity;
		this.lastRefill = this.clock();
	}

	/**
	 * Try to take one token without waiting. Returns `true` on success, `false`
	 * when the bucket is empty. Use this for non-blocking code paths — the
	 * 4.1.B orchestrator doesn't use it (the cache-hit path skips the bucket
	 * entirely per B2), but 5.x tests and the optional 4.1.C "button disabled
	 * while throttled" affordance will.
	 */
	tryTake(): boolean {
		this.refill();
		if (this.tokens < 1) return false;
		this.tokens -= 1;
		return true;
	}

	/**
	 * Take one token. Resolves immediately when the bucket has a token to
	 * spare, otherwise waits until the refill would grant one. Multiple
	 * concurrent waiters are queued FIFO; when a token is granted, the
	 * next waiter in line is woken (via its scheduled `setTimeout`).
	 */
	take(): Promise<void> {
		this.refill();
		if (this.tokens >= 1) {
			this.tokens -= 1;
			return Promise.resolve();
		}
		// Compute the deficit in tokens and the wall-clock wait.
		const deficit = 1 - this.tokens;
		const waitMs = Math.max(1, Math.ceil((deficit / this.rps) * 1000));
		return new Promise<void>((resolve) => {
			const handle = this.setTimeoutImpl(() => {
				// On wake: refill again, take the token, then resolve. The
				// refill handles the case where the clock jumped forward
				// (the user paused for a minute) and the bucket is now
				// flush again.
				this.refill();
				this.tokens = Math.max(0, this.tokens - 1);
				// Remove ourselves from the pending list. The list is small
				// (well under a dozen entries in practice) so a linear
				// search is fine.
				const idx = this.pending.findIndex((p) => p.resolve === resolve);
				if (idx >= 0) this.pending.splice(idx, 1);
				resolve();
			}, waitMs);
			this.pending.push({ resolve, handle });
		});
	}

	/**
	 * Token count, after a refill pass. For tests + a future 4.1.C "x tokens
	 * remaining" affordance in the modal info line.
	 */
	available(): number {
		this.refill();
		return this.tokens;
	}

	/**
	 * Number of waiters currently scheduled. Tests use this to assert
	 * "after a burst of N requests, N minus capacity waiters are queued".
	 */
	pendingCount(): number {
		return this.pending.length;
	}

	/**
	 * Drop all pending waiters — they all resolve immediately. Tests use
	 * this to assert queue behaviour without advancing the real clock.
	 */
	drain(): void {
		while (this.pending.length > 0) {
			const w = this.pending.shift();
			if (w === undefined) break;
			this.clearTimeoutImpl(w.handle);
			w.resolve();
		}
	}

	/**
	 * Refill the bucket based on elapsed time. Token count is clamped to
	 * capacity — we don't carry overflow past the burst ceiling.
	 */
	private refill(): void {
		const now = this.clock();
		const elapsedMs = now - this.lastRefill;
		if (elapsedMs <= 0) return;
		const earned = (elapsedMs / 1000) * this.rps;
		if (earned <= 0) return;
		this.tokens = Math.min(this.capacity, this.tokens + earned);
		this.lastRefill = now;
	}
}
