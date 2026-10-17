// tests/csl-to-paper.test.ts
//
// Unit tests for the pure CSL-JSON → `PaperManualInput` mapper. Focus is the
// 3.2 Citation-excellence C0 contract (D38, 2026-10): journal-level fields
// (volume / issue / pages / publisher) and the CSL `type` → `entryType`
// mapping — the fields that separate decent BibTeX from publication-grade —
// plus the pre-existing merge rules they're expected to keep (existing user
// input wins; string-or-array CSL text fields normalise to strings).

import { describe, expect, it } from 'vitest';
import { asText, cslToManualInput, mapCslTypeToEntryType } from '../src/services/citation/csl-to-paper';
import type { CslJsonRecord } from '../src/services/citation/types';

/** A realistic CrossRef `/works/{doi}` response (arrays for title fields). */
const crossrefStyleRecord: CslJsonRecord = {
  type: 'journal-article',
  title: ['Attention Is All You Need'],
  abstract: '<jats:p>The dominant models are based on RNNs.</jats:p>',
  'container-title': ['Advances in Neural Information Processing Systems'],
  volume: 30,
  issue: 12,
  page: '5998-6008',
  publisher: 'Curran Associates, Inc.',
  DOI: '10.5555/3295222.3295349',
  URL: 'https://arxiv.org/abs/1706.03762',
  keyword: 'transformers, attention',
  author: [
    { family: 'Vaswani', given: 'Ashish' },
    { family: 'Shazeer', given: 'Noam' },
  ],
  issued: { 'date-parts': [[2017, 6, 12]] },
};

describe('cslToManualInput — basics (regression)', () => {
  it('maps title, authors (+ first names), year, venue, doi, abstract, keywords', () => {
    const out = cslToManualInput(crossrefStyleRecord);
    expect(out.title).toBe('Attention Is All You Need');
    expect(out.authors).toEqual(['Vaswani', 'Shazeer']);
    expect(out.authorFirstNames).toEqual(['Ashish', 'Noam']);
    expect(out.year).toBe(2017);
    expect(out.venue).toBe('Advances in Neural Information Processing Systems');
    expect(out.doi).toBe('10.5555/3295222.3295349');
    expect(out.abstract).toBe('The dominant models are based on RNNs.');
    expect(out.keywords).toEqual(['transformers', 'attention']);
    expect(out.source).toBeUndefined(); // caller-driven only (4.1.C passes { source: 'doi' })
  });

  it('falls back to current-year + Untitled + empty authors on a bare record', () => {
    const out = cslToManualInput({});
    expect(out.title).toBe('Untitled');
    expect(out.authors).toEqual([]);
    expect(Number.isFinite(out.year)).toBe(true);
  });
});

describe('cslToManualInput — C0 publication metadata (D38)', () => {
  it('captures volume / issue / pages / publisher / entryType from a CrossRef-style record', () => {
    const out = cslToManualInput(crossrefStyleRecord);
    expect(out.volume).toBe('30');
    expect(out.issue).toBe('12');
    expect(out.pages).toBe('5998-6008');
    expect(out.publisher).toBe('Curran Associates, Inc.');
    expect(out.entryType).toBe('article');
  });

  it('coerces numeric volume/issue to strings but leaves absent fields absent', () => {
    const out = cslToManualInput({
      type: 'journal-article',
      title: 'Test',
      volume: 0,
      issue: 'special',
    });
    expect(out.volume).toBe('0'); // volume 0 exists in the wild (e.g. some preprint servers)
    expect(out.issue).toBe('special');
    expect(out.pages).toBeUndefined();
    expect(out.publisher).toBeUndefined();
    expect(out.entryType).toBe('article');
  });

  it('existing non-empty publication fields always win over the record', () => {
    const out = cslToManualInput(crossrefStyleRecord, {
      volume: '99',
      issue: '1',
      pages: '1-2',
      publisher: 'My Press',
      entryType: 'misc',
    });
    expect(out.volume).toBe('99');
    expect(out.issue).toBe('1');
    expect(out.pages).toBe('1-2');
    expect(out.publisher).toBe('My Press');
    expect(out.entryType).toBe('misc');
  });

  it('does not lose explicit type=preprint as misc (CSL vocabulary → our small set)', () => {
    const out = cslToManualInput({ type: 'preprint', title: 'x' });
    expect(out.entryType).toBe('misc');
  });
});

describe('mapCslTypeToEntryType', () => {
  it.each([
    ['journal-article', 'article'],
    ['article-journal', 'article'],
    ['paper-conference', 'inproceedings'],
    ['proceedings-article', 'inproceedings'],
    ['book', 'book'],
    ['chapter', 'incollection'],
    ['book-chapter', 'incollection'],
    ['thesis', 'thesis'],
    ['dissertation', 'thesis'],
    ['preprint', 'misc'],
    ['webpage', 'misc'],
  ])('maps %s → %s', (input, expected) => {
    expect(mapCslTypeToEntryType(input)).toBe(expected);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(mapCslTypeToEntryType('  Journal-Article ')).toBe('article');
  });

  it('returns undefined for unknown or empty types', () => {
    expect(mapCslTypeToEntryType('motion_picture')).toBeUndefined();
    expect(mapCslTypeToEntryType('')).toBeUndefined();
    expect(mapCslTypeToEntryType('   ')).toBeUndefined();
  });
});

describe('asText', () => {
  it('joins multi-part arrays with "; "', () => {
    expect(asText(['A', 'B'])).toBe('A; B');
  });
  it('returns undefined for empties', () => {
    expect(asText(undefined)).toBeUndefined();
    expect(asText([])).toBeUndefined();
    expect(asText('   ')).toBeUndefined();
    expect(asText([' ', ''])).toBeUndefined();
  });
});
