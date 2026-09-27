// src/services/citation/providers/openalex.ts
//
// OpenAlex provider — 4.1.B, trimmed in 4.1.F.1. The native→CSL mapper that
// used to live in `openalex-to-csl.ts` was folded into this file (its only
// consumer) and simplified: `reconstructAbstract` now uses a stable sort
// instead of a slot array, and the type mapping is a lookup table instead
// of a switch. OpenAlex's native response is NOT CSL-JSON (CrossRef's is,
// with the `?transform=…` flag); `openAlexWorkToCsl` below does the
// translation, then each record flows through the same `cslToManualInput`
// bridge as the CrossRef path.
//
// URL contract (OpenAlex REST API docs):
//   GET https://api.openalex.org/works/doi:<doi>            (DOI lookup; mailto forces the polite pool)
//   GET https://api.openalex.org/works?search=<q>&per_page=<n>   (title / bibliographic search)
//
// Error mapping (B9) is identical to the CrossRef provider — see the file
// header on `crossref.ts` for the full table.
//
// Design notes (locked in 4.1.B §8.2 / §14):
//   - B5: reconstruct `abstract` from `abstract_inverted_index`.
//   - B6: OpenAlex `type` → CSL `type` per the locked table below.
//   - B7: `best_oa_location.pdf_url` is surfaced as `URL`.
//   - All field reads go through `pickString` so unknown / null fields
//     short-circuit cleanly; we never throw on missing fields.
//
// Reference: https://docs.openalex.org/api-entities/works/work-object
//

import {
	CitationLookupError,
	type CitationProvider,
	type CitationProviderClient,
	type CslAuthor,
	type CslJsonRecord,
	type FetchImpl,
	type ProviderFetchOpts,
} from '../types';
import { applyObsidianFetch } from './_fetch-helper';

/**
 * The subset of the OpenAlex `Work` object we actually read. Hand-typed (not
 * imported from a package) so the bundle stays clean. Anything not in this
 * shape is ignored — we don't fail on unknown fields, since OpenAlex has
 * added new fields over the years and we want the mapper to stay
 * forward-compatible.
 */
interface OpenAlexWork {
	id?: string; // e.g. "https://openalex.org/W2741809807"
	doi?: string | null; // e.g. "https://doi.org/10.1109/cvpr.2016.90"
	title?: string | null;
	display_name?: string | null;
	abstract_inverted_index?: Record<string, number[]> | null;
	type?: string | null; // "article" | "book" | ...
	publication_year?: number | null;
	publication_date?: string | null; // "2016-06-01"
	authorships?: Array<{
		author?: { display_name?: string | null; orcid?: string | null } | null;
	}> | null;
	primary_location?: {
		source?: { display_name?: string | null } | null;
	} | null;
	best_oa_location?: {
		pdf_url?: string | null;
		source?: { display_name?: string | null } | null;
	} | null;
	concepts?: Array<{ display_name?: string | null }> | null;
	open_access?: { oa_url?: string | null; oa_status?: string | null } | null;
}

/**
 * OpenAlex `type` → CSL `type` (B6 spec, locked 2026-07-22). Missing keys
 * (and the ambiguous "other" bucket) intentionally map to `undefined`,
 * which means "don't set `type`".
 */
const OPENALEX_TYPE_TO_CSL: Record<string, string> = {
	article: 'journal-article',
	book: 'book',
	'book-chapter': 'chapter',
	dissertation: 'thesis',
	preprint: 'article', // CSL has no "preprint" type; "article" is the closest.
	review: 'review',
	report: 'report',
	dataset: 'dataset',
	editorial: 'article',
	letter: 'article',
	erratum: 'article',
};

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
function buildOpenAlexUrl(path: string, politeContact: string): string {
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

// ----- Native Work → CSL mapper (folded from openalex-to-csl.ts in 4.1.F.1) -----

/** Returns `undefined` for empty / whitespace-only / non-string inputs. */
function pickString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const t = value.trim();
	return t.length > 0 ? t : undefined;
}

/**
 * OpenAlex returns DOIs as the full URL form ("https://doi.org/10.xxxx/…").
 * CSL's `DOI` field is the bare DOI ("10.xxxx/…"). Strip the prefix.
 */
function doiFromOpenAlexDoi(doi: unknown): string | undefined {
	const s = pickString(doi);
	if (!s) return undefined;
	const lower = s.toLowerCase();
	for (const prefix of ['https://doi.org/', 'doi.org/']) {
		if (lower.startsWith(prefix)) return s.slice(prefix.length);
	}
	return s;
}

/**
 * Reconstruct the original abstract from OpenAlex's position-keyed inverted
 * index (`Record<word, number[]>` where each number is the position the word
 * occupies in the original string). We collect all (position, word) pairs,
 * stable-sort by position, and join with spaces.
 *
 * Per B5: this is the only stable way to recover the abstract — OpenAlex
 * doesn't return the original string. Ties keep insertion order because
 * ES2019+ `Array.prototype.sort` is stable.
 */
function reconstructAbstract(index: unknown): string | undefined {
	if (!index || typeof index !== 'object') return undefined;
	const buckets: Array<[number, string]> = [];
	for (const [word, rawPos] of Object.entries(index as Record<string, unknown>)) {
		if (!Array.isArray(rawPos)) continue;
		for (const p of rawPos) {
			if (typeof p === 'number' && Number.isFinite(p) && p >= 0) buckets.push([p, word]);
		}
	}
	if (buckets.length === 0) return undefined;
	const joined = buckets
		.sort((a, b) => a[0] - b[0])
		.map(([, w]) => w)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return joined.length > 0 ? joined : undefined;
}

/**
 * Build a CSL `issued` date-parts entry from OpenAlex's `publication_year`
 * and `publication_date`. `publication_date` is more precise ("2016-06-01")
 * and wins when present.
 */
function buildIssuedDate(year: unknown, date: unknown): CslJsonRecord['issued'] {
	const dateStr = pickString(date);
	if (dateStr) {
		const parts = dateStr.split('-').map((p) => Number.parseInt(p, 10));
		if (parts.length >= 1 && Number.isFinite(parts[0]) && parts[0]! > 1500 && parts[0]! < 3000) {
			const dateParts: [number] | [number, number] | [number, number, number] =
				parts.length >= 3 && Number.isFinite(parts[1]) && Number.isFinite(parts[2])
					? [parts[0]!, parts[1]!, parts[2]!]
					: parts.length >= 2 && Number.isFinite(parts[1])
						? [parts[0]!, parts[1]!]
						: [parts[0]!];
			return { 'date-parts': [dateParts] };
		}
	}
	if (typeof year === 'number' && Number.isFinite(year) && year > 1500 && year < 3000) {
		return { 'date-parts': [[year]] };
	}
	return undefined;
}

/**
 * OpenAlex names are typically a single "Given Family" or "Family, Given"
 * string. CSL wants `{family, given}`. We split on the *last* whitespace
 * for "Given Family" form, or on the first comma for "Family, Given" form.
 * OpenAlex mostly uses "Given Family" so the last-whitespace split is the
 * common case.
 */
function displayNameToCslAuthor(displayName: unknown): CslAuthor | null {
	const name = pickString(displayName);
	if (!name) return null;
	if (name.includes(',')) {
		const [family, ...rest] = name.split(',');
		const given = rest.join(',').trim();
		const f = family?.trim();
		if (!f) return null;
		return given ? { family: f, given } : { family: f };
	}
	// Last-whitespace split. If there's only one token, it goes to `family`
	// and `given` is empty (e.g. institutional authors).
	const lastSpace = name.lastIndexOf(' ');
	if (lastSpace < 0) {
		return { family: name };
	}
	const family = name.slice(lastSpace + 1).trim();
	const given = name.slice(0, lastSpace).trim();
	if (!family) return null;
	return { family, given: given || undefined };
}

/** OpenAlex `type` → CSL `type`, per the locked B6 table above. */
function mapOpenAlexTypeToCsl(oaType: string | undefined): string | undefined {
	return oaType ? OPENALEX_TYPE_TO_CSL[oaType.toLowerCase()] : undefined;
}

/**
 * Convert a single OpenAlex `Work` to a CSL-JSON record. Pure — no I/O, no
 * thrown exceptions on missing fields. The orchestrator wraps this call
 * inside the cache/limiter and converts the result via `cslToManualInput`.
 */
function openAlexWorkToCsl(work: OpenAlexWork): CslJsonRecord {
	const out: CslJsonRecord = {};

	const title = pickString(work.title ?? work.display_name);
	if (title) out.title = title;

	const cslType = mapOpenAlexTypeToCsl(pickString(work.type));
	if (cslType) out.type = cslType;

	const authors = (work.authorships ?? [])
		.map((a) => displayNameToCslAuthor(a?.author?.display_name))
		.filter((a): a is CslAuthor => a !== null);
	if (authors.length > 0) out.author = authors;

	const venue = pickString(
		work.primary_location?.source?.display_name
			?? work.best_oa_location?.source?.display_name,
	);
	if (venue) out['container-title'] = venue;

	const doi = doiFromOpenAlexDoi(work.doi);
	if (doi) out.DOI = doi;

	const url = pickString(work.best_oa_location?.pdf_url ?? work.open_access?.oa_url);
	if (url) out.URL = url;

	const abstract = reconstructAbstract(work.abstract_inverted_index);
	if (abstract) out.abstract = abstract;

	const issued = buildIssuedDate(work.publication_year, work.publication_date);
	if (issued) out.issued = issued;

	const subjects = (work.concepts ?? [])
		.map((c) => pickString(c?.display_name))
		.filter((s): s is string => s !== undefined);
	if (subjects.length > 0) {
		// Limit to the first 5 to keep the form preview from scrolling.
		out.subject = subjects.slice(0, 5).join('; ');
	}

	return out;
}
