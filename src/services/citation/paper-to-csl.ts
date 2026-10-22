// src/services/citation/paper-to-csl.ts
//
// C3.1 — the inverse of `csl-to-paper.ts`: pure `Paper` → CSL-JSON mapping.
// No I/O, no network, no Obsidian imports — unit-testable as-is.
//
// Why it exists: citeproc-js (the in-note citation renderer, C3) consumes
// CSL-JSON items, not our `Paper` shape. The Zotero/export paths feed pandoc
// BibTeX; this mapper feeds the bundled renderer so in-note citations use the
// *same* style engine and the same data the export flow renders.
//
// Field mapping mirrors what `BibliographyService` writes as BibTeX (D38):
// the D38 fields (volume/issue/pages/publisher/entryType) are additive —
// older papers simply lack them and the CSL record keeps its optional holes.
//
// `type` inversion note: `cslToManualInput` collapses preprint / report /
// dataset / webpage / manuscript all to BibTeX `misc`, so the inverse is
// lossy — `misc` maps to the generic CSL `document` type, which every style
// sheet renders sanely (title + author + year).

import type { Paper } from '../../types';
import type { CslAuthor, CslJsonRecord } from './types';

/** BibTeX-flavored entry types (D38) → CSL `type` vocabulary. */
const ENTRY_TYPE_TO_CSL: Readonly<Record<string, string>> = {
  article: 'article-journal',
  inproceedings: 'paper-conference',
  book: 'book',
  incollection: 'chapter',
  thesis: 'thesis',
  misc: 'document',
};

/** Invert the D38 entry type. Unknown values fall back to `document`. */
export function mapEntryTypeToCsl(entryType: string | undefined): string {
  return ENTRY_TYPE_TO_CSL[entryType ?? ''] ?? 'document';
}

/**
 * Build the CSL `author` array from the 2.8.E parallel-array shape: last
 * names in `authors`, optional first names in lockstep in `authorFirstNames`
 * (empty string = that author has only a last name).
 */
export function paperAuthorsToCsl(paper: Pick<Paper, 'authors' | 'authorFirstNames'>): CslAuthor[] {
  return paper.authors.map((family, index) => {
    const given = paper.authorFirstNames?.[index] ?? '';
    return given ? { family, given } : { family };
  });
}

/** Map a `Paper` to the CSL-JSON subset citeproc-js consumes. */
export function paperToCslJson(paper: Paper): CslJsonRecord {
  const record: CslJsonRecord = {
    // citeproc uses `id` to match `retrieveItem` results — the citekey is the
    // id the renderer addresses items by.
    id: paper.citekey,
    type: mapEntryTypeToCsl(paper.entryType),
    title: paper.title,
    author: paperAuthorsToCsl(paper),
    issued: { 'date-parts': [[paper.year]] },
  };
  if (paper.venue) record['container-title'] = paper.venue;
  if (paper.volume) record.volume = paper.volume;
  if (paper.issue) record.issue = paper.issue;
  if (paper.pages) record.page = paper.pages;
  if (paper.publisher) record.publisher = paper.publisher;
  if (paper.doi) record.DOI = paper.doi;
  if (paper.url) record.URL = paper.url;
  if (paper.abstract) record.abstract = paper.abstract;
  if (paper.keywords.length > 0) record.keyword = paper.keywords.join(', ');
  return record;
}
