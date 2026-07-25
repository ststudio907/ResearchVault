// src/services/citation/csl-to-paper.ts
//
// Pure mapping CSL-JSON record → `PaperManualInput`. No I/O, no network. This
// is the only "business logic" that ships fully implemented in 4.1.A —
// everything else around it is plumbing.
//
// 2.8.E author shape is "last names as a string[] with optional parallel
// first names". CSL authors are `{family, given}` objects. We split them
// across two parallel arrays so the YAML stays as a simple list.
//
// Quote capture in `Quote.provenance` is intentionally NOT driven from CSL
// (papers arrive via DOI lookup or paste, never via editor-captured quote).
//

import type { PaperManualInput } from '../paper-service';
import type { CslAuthor, CslDate, CslJsonRecord } from './types';

/**
 * Pre-existing user input from the import modal. Non-empty fields here stay
 * put so manual edits survive a re-lookup against the same DOI. The caller
 * decides the merge semantics — we just translate the record and return a
 * fully-shaped `PaperManualInput`.
 *
 * - Strings: existing non-empty wins; else filled from the CSL record; else
 *   omitted (or `'Untitled'` for the title field, which is required).
 * - Arrays (authors, keywords): existing non-empty wins.
 * - Year: existing finite-number wins; else parsed from `issued`; else the
 *   current calendar year.
 */
export function cslToManualInput(
  record: CslJsonRecord,
  existing?: Partial<PaperManualInput>,
): PaperManualInput {
  const pick = (e: string | undefined, r: string | undefined): string | undefined => {
    const es = e?.trim();
    if (es) return es;
    const rs = r?.trim();
    return rs || undefined;
  };

  const familyNames = authorNamesFromCsl(record.author) ?? [];
  const givenNamesRaw = authorGivenNamesFromCsl(record.author);
  const givenNames = ((): string[] | undefined => {
    if (!givenNamesRaw) return undefined;
    const padded = givenNamesRaw.slice(0, familyNames.length);
    while (padded.length < familyNames.length) padded.push('');
    return padded;
  })();

  const existingAuthors = existing?.authors && existing.authors.length > 0
    ? existing.authors
    : familyNames;

  const year = Number.isFinite(existing?.year)
    ? (existing!.year as number)
    : (yearFromCsl(record.issued) ?? new Date().getFullYear());

  const out: PaperManualInput = {
    title: pick(existing?.title, record.title) ?? 'Untitled',
    authors: existingAuthors,
    year,
  };

  // 4.1.A: when a record came from a DOI lookup, stamp `source: 'doi'` so the
  // resulting paper is distinguishable from manually-entered ones. Existing
  // explicit `source` (rare) wins; we only fall back when the caller didn't
  // pass one — `createManual` then sees `source === undefined` and falls back
  // to its `'pdf' | 'manual'` logic. We always suggest 'doi' here, but only
  // set it when the caller has signalled that the field is theirs to drive
  // (i.e. existing?.source is provided). 4.1.C can pass `source: 'doi'`
  // explicitly at the call site.
  if (existing?.source) {
    out.source = existing.source;
  }

  // Parallel first-name list — only attach when meaningful.
  const existingFirsts = existing?.authorFirstNames && existing.authorFirstNames.length > 0
    ? existing.authorFirstNames
    : givenNames;
  if (existingFirsts && existingFirsts.length > 0) {
    out.authorFirstNames = existingFirsts;
  }

  const venueFromTitle = pick(existing?.venue, record['container-title']);
  const venueFromShort = pick(undefined, record.shortTitle);
  const venue = venueFromTitle ?? venueFromShort;
  if (venue) out.venue = venue;

  const doi = pick(existing?.doi, record.DOI);
  if (doi) out.doi = doi;

  const url = pick(existing?.url, record.URL);
  if (url) out.url = url;

  // 3a (2026-07-22 user-flagged): abstract auto-fill is in the spec; both
  // providers return it for ~80–85% of journal-article DOIs. We just surface
  // what we got; the modal can preview it without forcing a manual entry.
  const abstract = pick(existing?.abstract, record.abstract);
  if (abstract) out.abstract = abstract;

  const existingKws = existing?.keywords ?? [];
  const cslKws = keywordsFromCsl(record);
  if (existingKws.length > 0) out.keywords = existingKws;
  else if (cslKws.length > 0) out.keywords = cslKws;

  return out;
}

/** Drop empty entries; preserve order; CSL "author" / OpenAlex "authors". */
function authorNamesFromCsl(authors: CslAuthor[] | undefined): string[] | undefined {
  if (!Array.isArray(authors) || authors.length === 0) return undefined;
  return authors
    .map((a) => {
      const f = a.family?.trim() ?? '';
      if (f) return f;
      const lit = a.literal?.trim();
      if (lit) return lit;
      return '';
    })
    .filter((s) => s.length > 0);
}

/** Parallel given-name array. Returns undefined if every entry is empty. */
function authorGivenNamesFromCsl(authors: CslAuthor[] | undefined): string[] | undefined {
  if (!Array.isArray(authors) || authors.length === 0) return undefined;
  const givens = authors.map((a) => a.given?.trim() ?? '');
  if (!givens.some((s) => s.length > 0)) return undefined;
  return givens;
}

/** Parse a CSL date — record['issued'] — into a 4-digit year. */
function yearFromCsl(date: CslDate | undefined): number | undefined {
  if (!date) return undefined;
  const parts = date['date-parts'];
  if (Array.isArray(parts) && parts.length > 0 && Array.isArray(parts[0]) && typeof parts[0][0] === 'number') {
    return parts[0][0];
  }
  // Fallback for ISO / raw / literal date strings like "2024-03-15" or "Spring 2024".
  const s = (date.raw ?? date.literal)?.trim();
  if (s) {
    const m = s.match(/\b(\d{4})\b/);
    // `noUncheckedIndexedAccess` makes `m[1]` `string | undefined` even after the `m` truthiness check.
    // The regex capture group always produces a value here, so narrow explicitly.
    const captured = m?.[1];
    if (captured !== undefined) {
      const y = Number.parseInt(captured, 10);
      if (Number.isFinite(y) && y > 1500 && y < 3000) return y;
    }
  }
  return undefined;
}

/** Merge CSL `keyword` (string) and OpenAlex `subject` (string) into a deduped array. */
function keywordsFromCsl(record: CslJsonRecord): string[] {
  const out: string[] = [];
  for (const raw of [record.keyword, record.subject]) {
    if (typeof raw !== 'string') continue;
    for (const piece of raw.split(/[,;]+/g)) {
      const t = piece.trim();
      if (t) out.push(t);
    }
  }
  return Array.from(new Set(out));
}
