// src/services/citation/providers/crossref.ts
//
// CrossRef provider — 4.1.B. Replaces the 4.1.A stub with real `fetch`
// calls. The response is CSL-JSON natively (CrossRef's `?transform=…` param
// hands us the format the orchestrator already understands), so the
// provider is a thin transport layer with no field mapping of its own.
//
// URL contract (CrossRef REST API docs):
//   GET https://api.crossref.org/works/<doi>?transform=application/vnd.citationstyles.csl+json
//   GET https://api.crossref.org/works?query.title=<title>&rows=<n>&transform=…csl+json
//   GET https://api.crossref.org/works?query.bibliographic=<query>&rows=<n>&transform=…csl+json
//
// Polite pool: when the settings `politeContact` is non-empty, the User-Agent
// header gets `mailto:<politeContact>` so we land in the polite pool (faster,
// better SLAs). When empty (Q2 locked: OFF by default), no identifier leaves
// the device and we land in the default pool.
//
// 4.1.B error mapping (B9):
//   200 → return parsed body
//   401/403 → throw `CitationLookupError({kind: 'network'})`
//   404 → throw `CitationLookupError({kind: 'not-found'})` for lookup;
//         for search, 404 is unusual (CrossRef typically returns an empty
//         `items` array on 200) — we treat it as an empty list.
//   429 → throw `CitationLookupError({kind: 'rate-limited'})`. The
//         orchestrator does the single retry-with-backoff per B9.
//   other 4xx → throw `CitationLookupError({kind: 'invalid-doi'})` for
//         lookup; empty list for search.
//   5xx + fetch throws → throw `CitationLookupError({kind: 'network'})`.
//

import {
	CitationLookupError,
	type CitationProvider,
	type CitationProviderClient,
	type CslJsonRecord,
	type FetchImpl,
	type ProviderFetchOpts,
} from '../types';
import { applyObsidianFetch } from './_fetch-helper';

export class CrossrefClient implements CitationProviderClient {
	readonly name: CitationProvider = 'crossref';

	async lookupByDoi(doi: string, opts: ProviderFetchOpts): Promise<CslJsonRecord | null> {
		const trimmed = doi.trim();
		if (!trimmed) return null;
		const url = `https://api.crossref.org/works/${encodeURIComponent(trimmed)}?transform=application/vnd.citationstyles.csl+json`;
		const body = await performLookupFetch(url, opts);
		return body;
	}

	async searchByTitle(title: string, limit: number, opts: ProviderFetchOpts): Promise<CslJsonRecord[]> {
		const trimmed = title.trim();
		if (!trimmed) return [];
		const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(trimmed)}&rows=${encodeLimit(limit)}&transform=application/vnd.citationstyles.csl+json`;
		return performSearchFetch(url, opts);
	}

	async searchByQuery(query: string, limit: number, opts: ProviderFetchOpts): Promise<CslJsonRecord[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];
		const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(trimmed)}&rows=${encodeLimit(limit)}&transform=application/vnd.citationstyles.csl+json`;
		return performSearchFetch(url, opts);
	}
}

/**
 * Build the User-Agent. The polite-pool contract is documented by CrossRef:
 * include `mailto:<value>` in the UA so they can reach out on abuse.
 * Returns the supplied default when no politeContact is set.
 */
export function buildUserAgent(defaultUA: string, politeContact: string): string {
	return politeContact ? `${defaultUA} (mailto:${politeContact})` : defaultUA;
}

/** Default UA. Static — `manifest.json`'s version is the source of truth for human-readable version. */
export const CROSSREF_DEFAULT_USER_AGENT = 'ResearchVaultObsidianPlugin/0.0 (https://github.com/researchvault)';

// ----- Internals -----

/** Cap `rows` at a sensible upper bound. CrossRef allows up to 1000; we hard-cap at 50 to keep the modal preview responsive. */
const MAX_LIMIT = 50;

function encodeLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) return 5;
	return Math.min(MAX_LIMIT, Math.floor(limit));
}

/**
 * The CrossRef "message" envelope: `{ status, 'message-type', message: <body> }`.
 * For lookup, the body is a single CSL record. For search, it's `{ items: [CSL...] }`.
 * We strip the envelope and return the inner content. When the body isn't
 * recognisable we surface it as a network error — that's a CrossRef schema
 * change we want to know about, not a silently-coerced empty list.
 */
async function performLookupFetch(url: string, opts: ProviderFetchOpts): Promise<CslJsonRecord | null> {
	const response = await getResponse(url, opts);
	const body = await parseBody(response);
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new CitationLookupError('network', 'CrossRef: lookup response is not an envelope object');
	}
	const inner = (body as { message?: unknown }).message;
	if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
		throw new CitationLookupError('network', 'CrossRef: lookup message is not a CSL object');
	}
	// `inner` is narrowed to `object` above. `CslJsonRecord` has only
	// optional fields, so the structural assignability is implicit —
	// any cast here is a no-op the linter rightly flags.
	return inner;
}

async function performSearchFetch(url: string, opts: ProviderFetchOpts): Promise<CslJsonRecord[]> {
	const response = await getResponse(url, opts);
	const body = await parseBody(response);
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new CitationLookupError('network', 'CrossRef: search response is not an envelope object');
	}
	const inner = (body as { message?: unknown }).message;
	if (Array.isArray(inner)) {
		return inner as CslJsonRecord[];
	}
	if (inner && typeof inner === 'object') {
		const items = (inner as { items?: unknown }).items;
		if (Array.isArray(items)) {
			return items as CslJsonRecord[];
		}
	}
	return [];
}

/**
 * Run a `fetch` against CrossRef. Returns a successful `Response` (2xx) or
 * throws a `CitationLookupError` with the right `kind` per B9. 404 / 4xx on
 * search calls are translated to empty list **by the caller** because the
 * caller knows whether it's in lookup or search mode.
 */
async function getResponse(url: string, opts: ProviderFetchOpts): Promise<Response> {
	const fetchImpl: FetchImpl = applyObsidianFetch(opts.fetchImpl);
	const headers: Record<string, string> = {
		Accept: 'application/vnd.citationstyles.csl+json, application/json',
		'User-Agent': buildUserAgent(CROSSREF_DEFAULT_USER_AGENT, opts.politeContact),
	};
	let response: Response;
	try {
		response = await fetchImpl(url, { method: 'GET', headers });
	} catch (err) {
		throw new CitationLookupError(
			'network',
			`CrossRef: fetch failed — ${(err as Error).message ?? 'unknown error'}`,
		);
	}
	const status = response.status;
	if (status >= 200 && status < 300) return response;
	if (status === 429) {
		throw new CitationLookupError('rate-limited', `CrossRef: 429 rate-limited`, status);
	}
	if (status === 404) {
		throw new CitationLookupError('not-found', `CrossRef: 404 not found`, status);
	}
	if (status === 401 || status === 403) {
		throw new CitationLookupError('network', `CrossRef: ${status} auth/permission denied`, status);
	}
	if (status >= 500) {
		throw new CitationLookupError('network', `CrossRef: ${status} server error`, status);
	}
	if (status >= 400) {
		// Other 4xx — orchestrator will map: lookup → 'invalid-doi', search → empty list.
		throw new CitationLookupError('invalid-doi', `CrossRef: ${status} invalid DOI`, status);
	}
	// 1xx/3xx shouldn't happen with `fetch` defaults, but be defensive.
	throw new CitationLookupError('network', `CrossRef: unexpected status ${status}`, status);
}

async function parseBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch (err) {
		throw new CitationLookupError(
			'network',
			`CrossRef: invalid JSON — ${(err as Error).message ?? 'unknown error'}`,
		);
	}
}

/** Re-export so consumers don't need to know it's different from `FetchImpl`. */
export type { FetchImpl };
