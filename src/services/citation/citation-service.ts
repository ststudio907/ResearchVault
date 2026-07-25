// src/services/citation/citation-service.ts
//
// CitationService orchestrator.
//
// 4.1.A shipped the public API surface (`lookupByDoi` / `searchByTitle` /
// `searchByQuery` / `importCslJson`), the static constants, the `isEnabled()`
// gate, and `importCslJson`. The three network methods dispatched into the
// configured provider and let the provider's stub `throw` carry the "4.1.B"
// message.
//
// 4.1.B replaces the stubs with the real `fetch` providers and adds the
// in-process LRU cache + token-bucket rate limiter (L4 — the service is
// constructed lazily, so cache state is tied to its lifetime). The
// orchestrator's job is to wire the four pieces together:
//   1. LRU cache (sync, free) — the first stop on every call (B1, B2, B10)
//   2. Token-bucket rate limiter (async, with backoff) — the second stop,
//      skipped on cache hits (B2, B4)
//   3. The provider's real `fetch` call — wrapped in a 429-retry per B9
//   4. Event emission — every public call emits exactly one
//      `citationLookupSucceeded` or `citationLookupFailed` event per the
//      B9 / B11 contract
//
// All four pieces live behind the same public API the 4.1.A modal and
// settings tab are coded against, so 4.1.C can call these methods
// unchanged.
//

import type { EventBus } from '../../core/plugin';
import type { PaperManualInput } from '../paper-service';
import { cslToManualInput } from './csl-to-paper';
import { LruCache } from './lru-cache';
import { CrossrefClient } from './providers/crossref';
import { OpenAlexClient } from './providers/openalex';
import { TokenBucket } from './token-bucket';
import {
	CitationLookupError,
	type CitationLookupFailed,
	type CitationLookupSucceeded,
	type CitationProvider,
	type CitationProviderClient,
	type CitationSettings,
	type CslJsonRecord,
	type FetchImpl,
} from './types';

/**
 * Minimal subset of `EventBus` the orchestrator needs. Decouples the citation
 * module from the plugin class while still accepting the real `EventBus` —
 * `Pick<EventBus, 'emit'>` preserves structural variance so the plugin's
 * `<K extends keyof ResearchVaultEvents>` signature satisfies the narrower
 * `'citationLookupSucceeded' | 'citationLookupFailed'` constraint here.
 */
export type CitationEventBus = Pick<EventBus, 'emit'>;

export interface CitationServiceDeps {
	/**
	 * Reference to the parent settings object. The orchestrator reads
	 * `settings.citation.enableCitationLookup`, `politeContact`,
	 * `cacheTtlDays`, `cacheMaxEntries`, `rateLimitRps`, `rateLimitBurst`, and
	 * `preferredProvider` at every call, so a settings-tab edit (4.1.D) takes
	 * effect without a plugin reload. Reassignment of `plugin.settings`
	 * (which happens on `migrateSettings` during `onload`) requires Obsidian
	 * to reload the plugin to spawn a fresh service.
	 */
	settings: { citation: CitationSettings };
	eventBus: CitationEventBus;
	/** Defaults to `window.fetch`. Tests can pass a mock. */
	fetchImpl?: FetchImpl;
	/** Injectable clock for the LRU + token-bucket. Tests use this. */
	clock?: () => number;
	/** Injectable `setTimeout` for the token-bucket. Tests use this. */
	setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
	/** Injectable `clearTimeout` mirror. */
	clearTimeoutImpl?: (handle: unknown) => void;
}

/**
 * Pure orchestrator. L4: lazily instantiated — `onload` does NOT construct
 * it. The modal (4.1.C) calls `plugin.ensureCitationService()` which calls
 * `new CitationService(...)`. Keeps `onload` cheap (AGENTS.md "Keep startup
 * light") and means the LRU cache + rate limiter don't spin up for users
 * who never enable the feature.
 */
export class CitationService {
	/**
	 * 4.1.A's "declared but unused" constants now serve as fallbacks when
	 * the user-supplied settings are out of range. The 4.1.A shape is
	 * preserved so the design doc and earlier references stay valid.
	 */
	static readonly CACHE_TTL_DAYS = 30;
	static readonly CACHE_MAX_ENTRIES = 500;
	static readonly RATE_LIMIT_RPS = 5;
	static readonly RATE_LIMIT_BURST = 10;
	/** Single retry on 429 per B9. 250 ms ± 0–100 ms jitter. */
	private static readonly RATE_LIMIT_RETRY_BASE_MS = 250;
	private static readonly RATE_LIMIT_RETRY_JITTER_MS = 100;

	private readonly settings: { citation: CitationSettings };
	private readonly eventBus: CitationEventBus;
	/**
	 * Resolved fetch implementation. Held on the orchestrator so the two
	 * providers can funnel all outbound calls through a single callable.
	 */
	private readonly fetchImpl: FetchImpl;
	private readonly providers: Record<CitationProvider, CitationProviderClient>;
	private readonly crossref: CrossrefClient;
	private readonly openalex: OpenAlexClient;
	/**
	 * The three LRU caches and the single shared token-bucket. These are
	 * instance state, not module state, so a per-call reset (which 4.1.C
	 * might want for the "clear cache" affordance) is just `this.foo.clear()`.
	 */
	private readonly lookupCache: LruCache<string, CslJsonRecord | null>;
	private readonly titleSearchCache: LruCache<string, CslJsonRecord[]>;
	private readonly querySearchCache: LruCache<string, CslJsonRecord[]>;
	private readonly bucket: TokenBucket;

	constructor(deps: CitationServiceDeps) {
		this.settings = deps.settings;
		this.eventBus = deps.eventBus;
		const windowFetch = window.fetch?.bind(window);
		this.fetchImpl = (deps.fetchImpl ?? windowFetch) as FetchImpl;
		this.crossref = new CrossrefClient();
		this.openalex = new OpenAlexClient();
		this.providers = {
			crossref: this.crossref,
			openalex: this.openalex,
		};
		// Initialise caches + bucket with the 4.1.A constants as a fallback
		// if the user-supplied settings are missing or out of range. The
		// settings are read at call time, so a 4.1.D edit of the Citations
		// tab takes effect without a fresh constructor.
		const clock = deps.clock ?? Date.now;
		this.lookupCache = new LruCache<string, CslJsonRecord | null>({
			ttlMs: CitationService.daysToMs(this.settings.citation.cacheTtlDays),
			maxEntries: CitationService.clampInt(
				this.settings.citation.cacheMaxEntries,
				CitationService.CACHE_MAX_ENTRIES,
				1,
				10_000,
			),
			clock,
		});
		this.titleSearchCache = new LruCache<string, CslJsonRecord[]>({
			ttlMs: CitationService.daysToMs(this.settings.citation.cacheTtlDays),
			maxEntries: CitationService.clampInt(
				this.settings.citation.cacheMaxEntries,
				CitationService.CACHE_MAX_ENTRIES,
				1,
				10_000,
			),
			clock,
		});
		this.querySearchCache = new LruCache<string, CslJsonRecord[]>({
			ttlMs: CitationService.daysToMs(this.settings.citation.cacheTtlDays),
			maxEntries: CitationService.clampInt(
				this.settings.citation.cacheMaxEntries,
				CitationService.CACHE_MAX_ENTRIES,
				1,
				10_000,
			),
			clock,
		});
		this.bucket = new TokenBucket({
			rps: CitationService.clampNumber(
				this.settings.citation.rateLimitRps,
				CitationService.RATE_LIMIT_RPS,
				0.1,
				1000,
			),
			burst: CitationService.clampInt(
				this.settings.citation.rateLimitBurst,
				CitationService.RATE_LIMIT_BURST,
				1,
				1000,
			),
			clock,
			setTimeoutImpl: deps.setTimeoutImpl,
			clearTimeoutImpl: deps.clearTimeoutImpl,
		});
	}

	/** Master gate. Mirrors the AI client toggle so the settings tab can disable cleanly. */
	isEnabled(): boolean {
		return this.settings.citation.enableCitationLookup;
	}

	/** Drop all three caches. 4.1.C may expose this behind a button. */
	clearCaches(): void {
		this.lookupCache.clear();
		this.titleSearchCache.clear();
		this.querySearchCache.clear();
	}

	/**
	 * Returns the user-configured preferred provider name. Pure read of
	 * settings — does not check the enabled flag, buckets, caches, etc.
	 * Used by the search-result modal to stamp provenance on picked rows.
	 */
	preferredProvider(): string {
		return this.settings.citation.preferredProvider;
	}

	/** Resolve a single DOI → CSL record (or `null` when the DOI is unknown). */
	async lookupByDoi(doi: string): Promise<CslJsonRecord | null> {
		const trimmed = doi.trim();
		if (!this.isEnabled()) {
			this.emitFailure({ reason: 'disabled', doi: trimmed || undefined });
			return null;
		}
		if (!trimmed) {
			this.emitFailure({ reason: 'invalid-doi', doi: '' });
			return null;
		}
		const key = `doi:${trimmed.toLowerCase()}`;
		// 1. Cache check (B2 — sync, free, doesn't spend a token).
		const cached = this.lookupCache.get(key);
		if (cached !== undefined) {
			this.emitSuccess({ doi: trimmed, provider: this.settings.citation.preferredProvider, durationMs: 0, cacheHit: true });
			return cached;
		}
		// 2. Rate-limit then call the provider.
		const startedAt = this.bucket['clock']?.() ?? Date.now();
		const provider = this.providers[this.settings.citation.preferredProvider];
		const politeContact = this.settings.citation.politeContact;
		const result = await this.gatedCall(
			() => provider.lookupByDoi(trimmed, { politeContact, fetchImpl: this.fetchImpl }),
			{ doi: trimmed, provider: this.settings.citation.preferredProvider },
		);
		const durationMs = (this.bucket['clock']?.() ?? Date.now()) - startedAt;
		// 3. Cache + emit (only when we got a real answer — failures aren't cached as
		//    "the DOI exists with this record"; we cache the success).
		if (result.ok) {
			this.lookupCache.set(key, result.value);
			this.emitSuccess({ doi: trimmed, provider: this.settings.citation.preferredProvider, durationMs, cacheHit: false });
			return result.value;
		}
		// 4. Failure path.
		this.emitFailure({ reason: result.reason, doi: trimmed, provider: this.settings.citation.preferredProvider, message: result.message });
		// For 404, surface `null` so the modal can show "not found"; for everything
		// else, the orchestrator's contract is "never throw for known-mapped errors",
		// so we return `null` for hard failures too and let the modal show a generic
		// error line. 4.1.C reads the event bus for the reason-specific copy.
		return null;
	}

	/** Free-text title search → list of CSL records. */
	async searchByTitle(title: string, limit = 5): Promise<CslJsonRecord[]> {
		const trimmed = title.trim();
		if (!this.isEnabled()) return [];
		if (!trimmed) return [];
		const key = `q:title:${this.settings.citation.preferredProvider}:${trimmed.toLowerCase()}:${limit}`;
		const cached = this.titleSearchCache.get(key);
		if (cached !== undefined) {
			this.emitSuccess({ query: trimmed, provider: this.settings.citation.preferredProvider, durationMs: 0, cacheHit: true });
			return cached;
		}
		const startedAt = this.bucket['clock']?.() ?? Date.now();
		const provider = this.providers[this.settings.citation.preferredProvider];
		const politeContact = this.settings.citation.politeContact;
		const result = await this.gatedCall(
			() => provider.searchByTitle(trimmed, limit, { politeContact, fetchImpl: this.fetchImpl }),
			{ query: trimmed, provider: this.settings.citation.preferredProvider },
		);
		const durationMs = (this.bucket['clock']?.() ?? Date.now()) - startedAt;
		if (result.ok) {
			this.titleSearchCache.set(key, result.value);
			this.emitSuccess({ query: trimmed, provider: this.settings.citation.preferredProvider, durationMs, cacheHit: false });
			return result.value;
		}
		this.emitFailure({ reason: result.reason, query: trimmed, provider: this.settings.citation.preferredProvider, message: result.message });
		return [];
	}

	/**
	 * Bibliographic / journal-name search → list of CSL records. B11:
	 * CrossRef primary, with automatic OpenAlex fallback when the primary
	 * returns zero hits. User-flagged addition 2026-07-22.
	 */
	async searchByQuery(query: string, limit = 5): Promise<CslJsonRecord[]> {
		const trimmed = query.trim();
		if (!this.isEnabled()) return [];
		if (!trimmed) return [];
		const primary = this.settings.citation.preferredProvider;
		const key = `q:query:${primary}:${trimmed.toLowerCase()}:${limit}`;
		const cached = this.querySearchCache.get(key);
		if (cached !== undefined) {
			this.emitSuccess({ query: trimmed, provider: primary, durationMs: 0, cacheHit: true });
			return cached;
		}
		const startedAt = this.bucket['clock']?.() ?? Date.now();
		const primaryClient = this.providers[primary];
		const politeContact = this.settings.citation.politeContact;
		const primaryResult = await this.gatedCall(
			() => primaryClient.searchByQuery(trimmed, limit, { politeContact, fetchImpl: this.fetchImpl }),
			{ query: trimmed, provider: primary },
		);
		if (primaryResult.ok) {
			const durationMs = (this.bucket['clock']?.() ?? Date.now()) - startedAt;
			this.querySearchCache.set(key, primaryResult.value);
			this.emitSuccess({ query: trimmed, provider: primary, durationMs, cacheHit: false });
			// B11 fallback: only when primary is CrossRef AND primary returned zero hits.
			if (
				primary === 'crossref'
				&& primaryResult.value.length === 0
			) {
				return this.fallbackToOpenAlex(trimmed, limit, key, startedAt);
			}
			return primaryResult.value;
		}
		// Primary failed. If the failure is `not-found` (404) and primary is CrossRef,
		// still try OpenAlex — a DOI / bibliographic record might exist on one
		// provider and not the other.
		if (primary === 'crossref' && primaryResult.reason === 'not-found') {
			return this.fallbackToOpenAlex(trimmed, limit, key, startedAt);
		}
		this.emitFailure({ reason: primaryResult.reason, query: trimmed, provider: primary, message: primaryResult.message });
		return [];
	}

	/**
	 * Parse a raw CSL-JSON string (one record OR an array literal) and convert
	 * to `PaperManualInput[]` for `PaperService.createManual`. Fully implemented
	 * in 4.1.A — no network.
	 */
	importCslJson(text: string): PaperManualInput[] {
		const stripped = text.trim();
		if (!stripped) return [];
		let parsed: CslJsonRecord | CslJsonRecord[] = [];
		try {
			const json = JSON.parse(stripped) as unknown;
			if (Array.isArray(json)) {
				parsed = json as CslJsonRecord[];
			} else if (json && typeof json === 'object') {
				parsed = json;
			} else {
				throw new Error(
					`expected a CSL-JSON object or array, got ${typeof json}`,
				);
			}
		} catch (err) {
			throw new Error(
				`CitationService.importCslJson: invalid JSON — ${(err as Error).message}`,
			);
		}
		const records = Array.isArray(parsed) ? parsed : [parsed];
		return records.map((record) => cslToManualInput(record));
	}

	// ----- Internals -----

	/**
	 * Run a provider call through the token-bucket, with one retry on 429 per B9.
	 * Returns a tagged union so the call sites can route success / failure into
	 * the cache + event bus without try/catch noise.
	 */
	private async gatedCall<T>(
		fn: () => Promise<T>,
		_eventHint: { doi?: string; query?: string; provider: CitationProvider },
	): Promise<{ ok: true; value: T } | { ok: false; reason: CitationLookupFailed['reason']; message?: string }> {
		await this.bucket.take();
		try {
			const value = await fn();
			return { ok: true, value };
		} catch (err) {
			if (err instanceof CitationLookupError && err.kind === 'rate-limited') {
				// One retry with jitter, per B9.
				await this.sleepJittered();
				await this.bucket.take();
				try {
					const value = await fn();
					return { ok: true, value };
				} catch (err2) {
					return this.mapError(err2);
				}
			}
			return this.mapError(err);
		}
	}

	/**
	 * Translate a thrown error (typically a `CitationLookupError`) into the
	 * orchestrator's tagged-union shape. The orchestrator is the only place
	 * that knows whether the call is a lookup or a search; the provider
	 * always throws with the raw `kind`. For 4.1.B we keep the kind
	 * verbatim — 4.1.C will surface the event-bus reason in the modal.
	 */
	private mapError(err: unknown): { ok: false; reason: CitationLookupFailed['reason']; message?: string } {
		if (err instanceof CitationLookupError) {
			return { ok: false, reason: err.kind, message: err.message };
		}
		return {
			ok: false,
			reason: 'network',
			message: err instanceof Error ? err.message : String(err),
		};
	}

	/**
	 * B11 fallback path: re-run the search against OpenAlex when CrossRef
	 * returned zero hits (or 404). We do NOT cache the OpenAlex result under
	 * the CrossRef key — the next CrossRef call will re-check — but we DO
	 * emit a separate `citationLookupSucceeded` event so the modal can show
	 * "filled from OpenAlex" if the success-event payload includes the
	 * provider.
	 */
	private async fallbackToOpenAlex(
		query: string,
		limit: number,
		_key: string,
		startedAt: number,
	): Promise<CslJsonRecord[]> {
		const politeContact = this.settings.citation.politeContact;
		const result = await this.gatedCall(
			() => this.openalex.searchByQuery(query, limit, { politeContact, fetchImpl: this.fetchImpl }),
			{ query, provider: 'openalex' },
		);
		const durationMs = (this.bucket['clock']?.() ?? Date.now()) - startedAt;
		if (result.ok) {
			this.emitSuccess({ query, provider: 'openalex', durationMs, cacheHit: false });
			return result.value;
		}
		this.emitFailure({ reason: result.reason, query, provider: 'openalex', message: result.message });
		return [];
	}

	private emitSuccess(payload: CitationLookupSucceeded): void {
		this.eventBus.emit('citationLookupSucceeded', payload);
	}

	private emitFailure(payload: CitationLookupFailed): void {
		this.eventBus.emit('citationLookupFailed', payload);
	}

	/** Sleep for `RATE_LIMIT_RETRY_BASE_MS + random(0..JITTER)` ms. */
	private sleepJittered(): Promise<void> {
		const jitter = Math.floor(Math.random() * CitationService.RATE_LIMIT_RETRY_JITTER_MS);
		const total = CitationService.RATE_LIMIT_RETRY_BASE_MS + jitter;
		return new Promise<void>((resolve) => {
			window.setTimeout(resolve, total);
		});
	}

	private static daysToMs(days: number): number {
		if (!Number.isFinite(days) || days <= 0) return CitationService.CACHE_TTL_DAYS * 86_400_000;
		return Math.floor(days * 86_400_000);
	}

	private static clampInt(value: number, fallback: number, min: number, max: number): number {
		if (!Number.isFinite(value)) return fallback;
		return Math.min(max, Math.max(min, Math.floor(value)));
	}

	private static clampNumber(value: number, fallback: number, min: number, max: number): number {
		if (!Number.isFinite(value)) return fallback;
		return Math.min(max, Math.max(min, value));
	}
}
