// src/services/citation/providers/openalex.ts
//
// OpenAlex provider — 4.1.B. Replaces the 4.1.A stub with real `fetch`
// calls. OpenAlex's native response is NOT CSL-JSON (CrossRef's is, with
// the `?transform=…` flag); the `openAlexWorkToCsl` mapper in
// `openalex-to-csl.ts` does the native → CSL translation. After mapping,
// each record flows through the same `cslToManualInput` bridge as the
// CrossRef path, so the orchestrator and modal see one shape.
//
// URL contract (OpenAlex REST API docs):
//   GET https://api.openalex.org/works/doi:<doi>            (DOI lookup; mailto forces the polite pool)
//   GET https://api.openalex.org/works?search=<title>&per_page=<n>     (free-text title search)
//   GET https://api.openalex.org/works?search=<query>&per_page=<n>     (bibliographic / journal-name search)
//
// 4.1.B error mapping (B9) is identical to the CrossRef provider — see
// the file header on `crossref.ts` for the full table. We throw
// `CitationLookupError` with the right `kind` and let the orchestrator
// translate per the calling mode (lookup vs search).
//

import {
	CitationLookupError,
	type CitationProvider,
	type CitationProviderClient,
	type CslJsonRecord,
	type FetchImpl,
	type ProviderFetchOpts,
} from '../types';
import { openAlexWorkToCsl, type OpenAlexWork } from '../openalex-to-csl';
import { applyObsidianFetch } from './_fetch-helper';

export class OpenAlexClient implements CitationProviderClient {
	readonly name: CitationProvider = 'openalex';

	async lookupByDoi(doi: string, opts: ProviderFetchOpts): Promise<CslJsonRecord | null> {
		const trimmed = doi.trim();
		if (!trimmed) return null;
		const url = buildOpenAlexUrl(`/works/doi:${encodeURIComponent(trimmed)}`, opts.politeContact);
		const body = await performLookupFetch(url, opts);
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			throw new CitationLookupError('network', 'OpenAlex: lookup response is not a Work object');
		}
		// `body` is narrowed to `object` above. `OpenAlexWork` has only
		// optional fields, so the structural assignability is implicit —
		// any cast here is a no-op the linter rightly flags.
		return openAlexWorkToCsl(body);
	}

	async searchByTitle(title: string, limit: number, opts: ProviderFetchOpts): Promise<CslJsonRecord[]> {
		const trimmed = title.trim();
		if (!trimmed) return [];
		const url = buildOpenAlexUrl(
			`/works?search=${encodeURIComponent(trimmed)}&per_page=${encodeLimit(limit)}`,
			opts.politeContact,
		);
		return performSearchFetch(url, opts);
	}

	async searchByQuery(query: string, limit: number, opts: ProviderFetchOpts): Promise<CslJsonRecord[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];
		const url = buildOpenAlexUrl(
			`/works?search=${encodeURIComponent(trimmed)}&per_page=${encodeLimit(limit)}`,
			opts.politeContact,
		);
		return performSearchFetch(url, opts);
	}
}

/** OpenAlex polite pool requires `mailto` as a query param, not inside the User-Agent. */
export function buildOpenAlexUrl(path: string, politeContact: string): string {
	if (!politeContact) return `https://api.openalex.org${path}`;
	const sep = path.includes('?') ? '&' : '?';
	return `https://api.openalex.org${path}${sep}mailto=${encodeURIComponent(politeContact)}`;
}

// ----- Internals -----

const MAX_LIMIT = 50;

function encodeLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) return 5;
	return Math.min(MAX_LIMIT, Math.floor(limit));
}

async function performLookupFetch(url: string, opts: ProviderFetchOpts): Promise<unknown> {
	const response = await getResponse(url, opts);
	try {
		return await response.json();
	} catch (err) {
		throw new CitationLookupError(
			'network',
			`OpenAlex: invalid JSON — ${(err as Error).message ?? 'unknown error'}`,
		);
	}
}

async function performSearchFetch(url: string, opts: ProviderFetchOpts): Promise<CslJsonRecord[]> {
	const response = await getResponse(url, opts);
	let body: unknown;
	try {
		body = await response.json();
	} catch (err) {
		throw new CitationLookupError(
			'network',
			`OpenAlex: invalid JSON — ${(err as Error).message ?? 'unknown error'}`,
		);
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new CitationLookupError('network', 'OpenAlex: search response is not a results object');
	}
	const results = (body as { results?: unknown }).results;
	if (!Array.isArray(results)) return [];
	return results
		.filter((r): r is OpenAlexWork => !!r && typeof r === 'object' && !Array.isArray(r))
		.map((work) => openAlexWorkToCsl(work));
}

/** Same shape as the CrossRef equivalent. See `crossref.ts: getResponse` for the B9 mapping table. */
async function getResponse(url: string, opts: ProviderFetchOpts): Promise<Response> {
	const fetchImpl: FetchImpl = applyObsidianFetch(opts.fetchImpl);
	const headers: Record<string, string> = {
		Accept: 'application/json',
	};
	let response: Response;
	try {
		response = await fetchImpl(url, { method: 'GET', headers });
	} catch (err) {
		throw new CitationLookupError(
			'network',
			`OpenAlex: fetch failed — ${(err as Error).message ?? 'unknown error'}`,
		);
	}
	const status = response.status;
	if (status >= 200 && status < 300) return response;
	if (status === 429) {
		throw new CitationLookupError('rate-limited', `OpenAlex: 429 rate-limited`, status);
	}
	if (status === 404) {
		throw new CitationLookupError('not-found', `OpenAlex: 404 not found`, status);
	}
	if (status === 401 || status === 403) {
		throw new CitationLookupError('network', `OpenAlex: ${status} auth/permission denied`, status);
	}
	if (status >= 500) {
		throw new CitationLookupError('network', `OpenAlex: ${status} server error`, status);
	}
	if (status >= 400) {
		throw new CitationLookupError('invalid-doi', `OpenAlex: ${status} invalid DOI`, status);
	}
	throw new CitationLookupError('network', `OpenAlex: unexpected status ${status}`, status);
}
