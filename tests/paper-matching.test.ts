// tests/paper-matching.test.ts
//
// Unit tests for the same-paper detection that powers the shared PDF
// library (D34, 2026-10 refactor). Pure module — no vault involved.

import { describe, expect, it } from 'vitest';
import type { Paper } from '../src/types';
import {
  DEFAULT_PDF_LIBRARY_FOLDER,
  findSamePaper,
  isInsideFolder,
  normalizeDoi,
  normalizePdfLibraryFolder,
} from '../src/services/papers/paper-matching';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'proj-a/smith_2023_deep',
    citekey: 'smith_2023_deep',
    title: 'Deep Learning',
    authors: ['Goodfellow', 'Bengio'],
    year: 2015,
    keywords: [],
    status: 'unread',
    priority: 'normal',
    dateAdded: 1000,
    dateModified: 2000,
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: { projectId: 'proj-a' },
    source: 'manual',
    ...overrides,
  };
}

describe('normalizeDoi', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeDoi(undefined)).toBeUndefined();
    expect(normalizeDoi('   ')).toBeUndefined();
  });

  it('strips URL prefixes and lowercases', () => {
    expect(normalizeDoi('10.1126/SCIENCE.1259855')).toBe('10.1126/science.1259855');
    expect(normalizeDoi('https://doi.org/10.1126/Science.1259855')).toBe('10.1126/science.1259855');
    expect(normalizeDoi('http://dx.doi.org/10./ABC')).toBe('10./abc');
    expect(normalizeDoi('doi:10.1/X ')).toBe('10.1/x');
  });
});

describe('findSamePaper', () => {
  const existing = makePaper({ doi: '10.5555/x', pdfPath: 'Research Vault/pdfs/smith_2023_deep.pdf' });

  it('matches on normalized DOI across URL/plain variants', () => {
    const match = findSamePaper([existing], { doi: 'https://doi.org/10.5555/x' }, 'proj-b');
    expect(match?.paper).toBe(existing);
    expect(match?.via).toBe('doi');
  });

  it('prefers the DOI match over a coincidental title match on another paper', () => {
    const decoy = makePaper({
      id: 'proj-c/smith_2023_deep',
      customFields: { projectId: 'proj-c' },
      doi: '10.9999/other',
    });
    // Both papers share title/authors/year; the DOI hit on `existing` wins.
    const match = findSamePaper(
      [decoy, existing],
      { doi: '10.5555/x', title: 'Deep Learning', authors: ['Goodfellow'], year: 2015 },
      'proj-b',
    );
    expect(match?.paper).toBe(existing);
    expect(match?.via).toBe('doi');
  });

  it('falls back to title + primary author last name + year (case-insensitive)', () => {
    const noDoi = makePaper({ doi: undefined });
    const match = findSamePaper(
      [noDoi],
      { title: '  DEEP learning ', authors: ['GOODFELLOW'], year: 2015 },
      'proj-b',
    );
    expect(match?.paper).toBe(noDoi);
    expect(match?.via).toBe('title-author-year');
  });

  it('does NOT match on citekey alone — different paper, same citekey, must not merge (D34)', () => {
    const cousin = makePaper({ title: 'An Unrelated Paper', doi: undefined, year: 2019 });
    const match = findSamePaper(
      [cousin],
      { title: 'Deep Learning', authors: ['Goodfellow'], year: 2015 },
      'proj-b',
    );
    expect(match).toBeUndefined();
  });

  it('excludes papers in the target project (same-project duplicates are citekey resolution\u2019s job)', () => {
    const match = findSamePaper([existing], { doi: '10.5555/x' }, 'proj-a');
    expect(match).toBeUndefined();
  });

  it('reports year or author mismatches as no match', () => {
    const match = findSamePaper(
      [makePaper({ doi: undefined })],
      { title: 'Deep Learning', authors: ['Goodfellow'], year: 2016 },
      'proj-b',
    );
    expect(match).toBeUndefined();
    const authorMiss = findSamePaper(
      [makePaper({ doi: undefined })],
      { title: 'Deep Learning', authors: ['LeCun'], year: 2015 },
      'proj-b',
    );
    expect(authorMiss).toBeUndefined();
  });
});

describe('isInsideFolder', () => {
  it('recognizes the folder itself and children, but not similar prefixes', () => {
    expect(isInsideFolder('Research Vault/pdfs', 'Research Vault/pdfs')).toBe(true);
    expect(isInsideFolder('Research Vault/pdfs/a.pdf', 'Research Vault/pdfs')).toBe(true);
    expect(isInsideFolder('Research Vault/pdfs-old/a.pdf', 'Research Vault/pdfs')).toBe(false);
    expect(isInsideFolder('X/pdfs/a.pdf', 'Research Vault/pdfs')).toBe(false);
  });
});

describe('normalizePdfLibraryFolder', () => {
  it('trims whitespace and surrounding slashes, defaulting when empty', () => {
    expect(normalizePdfLibraryFolder(' /pdfs/ ')).toBe('pdfs');
    expect(normalizePdfLibraryFolder('')).toBe(DEFAULT_PDF_LIBRARY_FOLDER);
    expect(normalizePdfLibraryFolder(undefined)).toBe(DEFAULT_PDF_LIBRARY_FOLDER);
    expect(normalizePdfLibraryFolder('vault lib')).toBe('vault lib');
  });
});
