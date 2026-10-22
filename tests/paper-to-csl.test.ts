// tests/paper-to-csl.test.ts
//
// C3.1 — Paper → CSL-JSON mapping for the in-note citeproc renderer.

import { describe, expect, it } from 'vitest';
import {
  mapEntryTypeToCsl,
  paperAuthorsToCsl,
  paperToCslJson,
} from '../src/services/citation/paper-to-csl';
import type { Paper } from '../src/types';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'proj1/smith_2020',
    citekey: 'smith_2020',
    title: 'Learning deep representations',
    authors: ['Smith', 'Jones'],
    authorFirstNames: ['Jane', 'Bob'],
    year: 2020,
    entryType: 'article',
    keywords: [],
    status: 'unread',
    priority: 'normal',
    dateAdded: 0,
    dateModified: 0,
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: {},
    source: 'manual',
    ...overrides,
  };
}

describe('mapEntryTypeToCsl', () => {
  it('maps the six BibTeX-flavored entry types to CSL types', () => {
    expect(mapEntryTypeToCsl('article')).toBe('article-journal');
    expect(mapEntryTypeToCsl('inproceedings')).toBe('paper-conference');
    expect(mapEntryTypeToCsl('book')).toBe('book');
    expect(mapEntryTypeToCsl('incollection')).toBe('chapter');
    expect(mapEntryTypeToCsl('thesis')).toBe('thesis');
  });

  it('falls back to the generic CSL document type for misc and unknown', () => {
    expect(mapEntryTypeToCsl('misc')).toBe('document');
    expect(mapEntryTypeToCsl(undefined)).toBe('document');
    expect(mapEntryTypeToCsl('bogus')).toBe('document');
  });
});

describe('paperAuthorsToCsl', () => {
  it('splits the parallel-array author shape into CSL family/given', () => {
    expect(
      paperAuthorsToCsl({
        authors: ['Smith', 'Jones'],
        authorFirstNames: ['Jane', 'Bob'],
      }),
    ).toEqual([
      { family: 'Smith', given: 'Jane' },
      { family: 'Jones', given: 'Bob' },
    ]);
  });

  it('emits family-only authors when first names are absent or empty', () => {
    expect(paperAuthorsToCsl({ authors: ['Cher', 'Plato'] })).toEqual([
      { family: 'Cher' },
      { family: 'Plato' },
    ]);
    expect(
      paperAuthorsToCsl({ authors: ['Cher'], authorFirstNames: [''] }),
    ).toEqual([{ family: 'Cher' }]);
  });
});

describe('paperToCslJson', () => {
  it('maps the core fields citeproc needs (id, type, title, author, issued)', () => {
    const record = paperToCslJson(makePaper());
    expect(record.id).toBe('smith_2020');
    expect(record.type).toBe('article-journal');
    expect(record.title).toBe('Learning deep representations');
    expect(record.author).toEqual([
      { family: 'Smith', given: 'Jane' },
      { family: 'Jones', given: 'Bob' },
    ]);
    expect(record.issued).toEqual({ 'date-parts': [[2020]] });
  });

  it('carries the D38 publication fields when present', () => {
    const record = paperToCslJson(
      makePaper({
        authorFirstNames: ['Jane'],
        venue: 'Journal of Testing',
        volume: '12',
        issue: '3',
        pages: '1-20',
        publisher: 'Academic Press',
        doi: '10.1/x',
        url: 'https://example.com',
        keywords: ['deep learning', 'review'],
      }),
    );
    expect(record['container-title']).toBe('Journal of Testing');
    expect(record.volume).toBe('12');
    expect(record.issue).toBe('3');
    expect(record.page).toBe('1-20');
    expect(record.publisher).toBe('Academic Press');
    expect(record.DOI).toBe('10.1/x');
    expect(record.URL).toBe('https://example.com');
    expect(record.keyword).toBe('deep learning, review');
  });

  it('leaves optional fields out when the paper does not have them', () => {
    const record = paperToCslJson(makePaper());
    expect(record).not.toHaveProperty('container-title');
    expect(record).not.toHaveProperty('volume');
    expect(record).not.toHaveProperty('DOI');
    expect(record).not.toHaveProperty('keyword');
  });
});
