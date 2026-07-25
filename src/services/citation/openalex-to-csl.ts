// src/services/citation/openalex-to-csl.ts
//
// Hand-rolled OpenAlex `Work` → CSL-JSON record mapper. The output of this
// function is then fed through `cslToManualInput` (4.1.A) to land in the
// import-modal form, so the contract here is "produce a `CslJsonRecord`
// whose fields line up with what `cslToManualInput` already understands".
//
// Why hand-rolled? `@citation-types/csl-json` is ~30 KB and OpenAlex's native
// response shape is small enough that pulling in a full mapping library
// would more than double the bundle cost. The fields OpenAlex returns that
// we care about are well-documented in their API reference; we map them
// straight.
//
// Design notes (locked in 4.1.B §8.2 / §14):
//   - B5: reconstruct `abstract` from `abstract_inverted_index` (a
//     `Record<string, number[]>` keyed by word with position arrays). The
//     original string is a stable join of the words at their positions.
//   - B6: map OpenAlex `type` vocabulary → CSL `type` vocabulary. OpenAlex
//     uses `article | book | book-chapter | dissertation | preprint |
//     review | report | dataset | other`. CSL uses `journal-article | book
//     | chapter | thesis | article | report | dataset | ...`. Most are
//     direct renames; the ambiguous ones are noted inline.
//   - B7: the OpenAlex `best_oa_location.pdf_url` is the OA-PDF URL.
//     We surface it as `URL` (the modal's "publisher landing page" is a
//     future affordance). The future 4.1.C "attach this OA PDF" hook will
//     look for this URL separately — we don't pre-empt that field shape
//     here.
//   - All field reads go through the local `pick` / `pickString` helpers
//     so unknown / null fields short-circuit cleanly. We never throw on
//     missing fields; the orchestrator turns "no DOI" / "no abstract" into
//     a successful lookup with fewer filled form fields.
//
// Reference: https://docs.openalex.org/api-entities/works/work-object
//

import type { CslAuthor, CslJsonRecord } from './types';

/**
 * The subset of the OpenAlex `Work` object we actually read. Hand-typed
 * (not imported from a package) so the 4.1.B bundle stays clean. Anything
 * not in this shape is ignored — we don't fail on unknown fields, since
 * OpenAlex has added new fields over the years and we want the mapper to
 * stay forward-compatible.
 */
export interface OpenAlexWork {
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
 * Convert a single OpenAlex `Work` to a CSL-JSON record. Pure — no I/O, no
 * thrown exceptions on missing fields. The orchestrator wraps this call
 * inside the cache/limiter and converts the result via `cslToManualInput`.
 */
export function openAlexWorkToCsl(work: OpenAlexWork): CslJsonRecord {
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

// ----- Helpers -----

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
	const prefix = 'https://doi.org/';
	if (s.toLowerCase().startsWith(prefix)) {
		return s.slice(prefix.length);
	}
	const dxPrefix = 'doi.org/';
	const lower = s.toLowerCase();
	if (lower.startsWith(dxPrefix)) {
		return s.slice(dxPrefix.length);
	}
	return s;
}

/**
 * Reconstruct the original abstract from OpenAlex's position-keyed inverted
 * index. The index is `Record<word, number[]>` where each number is the
 * position the word occupies in the original string. We bucket all words
 * by position, sort by position, and join with spaces.
 *
 * Per B5: this is the only stable way to recover the abstract — OpenAlex
 * doesn't return the original string.
 */
function reconstructAbstract(index: unknown): string | undefined {
	if (!index || typeof index !== 'object') return undefined;
	const entries = Object.entries(index as Record<string, unknown>);
	if (entries.length === 0) return undefined;
	// Bucket by position. OpenAlex's positions are 0-indexed and may be sparse
	// (gaps when a word is repeated at non-adjacent positions). We allocate
	// an array big enough to hold the largest position, then drop in.
	const buckets: Array<[string, number]> = [];
	let maxPos = 0;
	for (const [word, rawPos] of entries) {
		if (!Array.isArray(rawPos)) continue;
		for (const p of rawPos) {
			if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) continue;
			buckets.push([word, p]);
			if (p > maxPos) maxPos = p;
		}
	}
	if (buckets.length === 0) return undefined;
	// Build the output array at maxPos+1 and slot words in. Multiple words at
	// the same position (rare but possible) appear in insertion order, which
	// preserves OpenAlex's order.
	// `new Array<string>(n)` returns `any[]` in lib.dom, so we use the
	// explicit generic on the constructor and seed the slots with
	// `undefined` (the empty-slot sentinel used below).
	const slots: Array<string | undefined> = new Array<string>(maxPos + 1);
	for (const [word, p] of buckets) {
		// Only fill empty slots — OpenAlex's iteration order is the source
		// of truth for "which word came first when positions tie".
		if (slots[p] === undefined) {
			slots[p] = word;
		}
	}
	// Compact: drop leading / trailing empty slots (defensive — OpenAlex
	// usually gives a dense array but we don't want stray whitespace at
	// either end).
	let first = 0;
	let last = slots.length - 1;
	while (first <= last && slots[first] === undefined) first++;
	while (last >= first && slots[last] === undefined) last--;
	if (first > last) return undefined;
	const joined = slots.slice(first, last + 1).join(' ').replace(/\s+/g, ' ').trim();
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

/**
 * OpenAlex `type` → CSL `type`. The OpenAlex vocabulary is small and
 * mostly aligns with CSL — most entries are direct renames. B6 spec
 * (locked 2026-07-22).
 */
function mapOpenAlexTypeToCsl(oaType: string | undefined): string | undefined {
	if (!oaType) return undefined;
	const m = oaType.toLowerCase();
	switch (m) {
		case 'article':
			return 'journal-article';
		case 'book':
			return 'book';
		case 'book-chapter':
			return 'chapter';
		case 'dissertation':
			return 'thesis';
		case 'preprint':
			return 'article'; // CSL doesn't have a "preprint" type; "article" is the closest. We could set `genre: 'preprint'` but that's a future refinement.
		case 'review':
			return 'review';
		case 'report':
			return 'report';
		case 'dataset':
			return 'dataset';
		case 'editorial':
			return 'article';
		case 'letter':
			return 'article';
		case 'erratum':
			return 'article';
		case 'paratext':
			return undefined; // Skip — front-matter / back-matter isn't a citable type.
		case 'other':
		default:
			return undefined; // Don't set `type` for the ambiguous "other" bucket.
	}
}
