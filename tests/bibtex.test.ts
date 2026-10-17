// tests/bibtex.test.ts
//
// Golden-fixture tests for the hand-rolled publication-grade BibTeX
// serializer (3.2 Citation excellence C1 / D36). These are the entries the
// manual smoke then re-parses in an external manager (Zotero/Better BibTeX or
// JabRef); if a fixture here changes shape, the external parse needs a
// re-check before release.

import { describe, expect, it } from 'vitest';
import type { Paper } from '../src/types';
import {
  BIBTEX_GENERATED_HEADER,
  bibtexAuthors,
  escapeBibtexValue,
  normalizeBibtexPages,
  papersToBibtex,
  paperToBibtexEntry,
} from '../src/services/citation/bibtex';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'p-1',
    citekey: 'smith_2023_test',
    title: 'A Test Paper',
    authors: ['Smith'],
    year: 2023,
    keywords: [],
    status: 'reading',
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

describe('paperToBibtexEntry — golden fixtures', () => {
  it('renders a fully-specified journal article in stable field order', () => {
    const out = paperToBibtexEntry(makePaper({
      citekey: 'vaswani_2017_attention',
      title: 'Attention Is All You Need',
      authors: ['Vaswani', 'Shazeer'],
      authorFirstNames: ['Ashish', 'Noam'],
      year: 2017,
      venue: 'Advances in Neural Information Processing Systems',
      volume: '30',
      issue: '12',
      pages: '5998-6008',
      publisher: 'Curran Associates, Inc.',
      doi: '10.5555/3295222.3295349',
      url: 'https://arxiv.org/abs/1706.03762',
      keywords: ['transformers', 'attention'],
      abstract: 'The dominant models are based on RNNs.',
    }));
    expect(out).toBe(`@article{vaswani_2017_attention,
  author = {Vaswani, Ashish and Shazeer, Noam},
  title = {Attention Is All You Need},
  year = {2017},
  journal = {Advances in Neural Information Processing Systems},
  volume = {30},
  number = {12},
  pages = {5998--6008},
  publisher = {Curran Associates, Inc.},
  doi = {10.5555/3295222.3295349},
  url = {https://arxiv.org/abs/1706.03762},
  keywords = {transformers, attention},
  abstract = {The dominant models are based on RNNs.},
}`);
  });

  it('falls back to @article when entryType is absent (D36)', () => {
    const out = paperToBibtexEntry(makePaper({ entryType: undefined }));
    expect(out.startsWith('@article{')).toBe(true);
  });

  it('dispatches venue to the container field each entry type expects', () => {
    const shared = { venue: 'Some Container', publisher: 'Some Press' };
    expect(paperToBibtexEntry(makePaper({ ...shared, entryType: 'inproceedings' })))
      .toContain('booktitle = {Some Container}');
    expect(paperToBibtexEntry(makePaper({ ...shared, entryType: 'incollection' })))
      .toContain('booktitle = {Some Container}');
    expect(paperToBibtexEntry(makePaper({ ...shared, entryType: 'book' })))
      .toContain('series = {Some Container}');
    expect(paperToBibtexEntry(makePaper({ ...shared, entryType: 'thesis' })))
      .toContain('school = {Some Container}');
    expect(paperToBibtexEntry(makePaper({ ...shared, entryType: 'misc' })))
      .toContain('howpublished = {Some Container}');
  });

  it('escapes the BibTeX-breaking characters in field values', () => {
    const out = paperToBibtexEntry(makePaper({
      title: 'Performance of 100% & the {X_net} #1 system',
    }));
    expect(out).toContain('title = {Performance of 100\\% \\& the \\{X\\_net\\} \\#1 system}');
  });

  it('omits absent optional fields entirely (no empty braces)', () => {
    const out = paperToBibtexEntry(makePaper());
    expect(out).not.toContain('volume');
    expect(out).not.toContain('number =');
    expect(out).not.toContain('pages');
    expect(out).not.toContain('publisher');
    expect(out).not.toContain('doi');
    expect(out).not.toContain('url');
    expect(out).not.toContain('keywords');
    expect(out).not.toContain('abstract');
    expect(out).toBe(`@article{smith_2023_test,
  author = {Smith},
  title = {A Test Paper},
  year = {2023},
}`);
  });
});

describe('bibtexAuthors', () => {
  it('pairs last names with first names positionally', () => {
    expect(bibtexAuthors(makePaper({ authors: ['Smith', 'Jones'], authorFirstNames: ['Ada', 'Bob'] })))
      .toBe('Smith, Ada and Jones, Bob');
  });
  it('emits a bare last name when no first name is paired (org authors)', () => {
    expect(bibtexAuthors(makePaper({ authors: ['World Bank'] }))).toBe('World Bank');
  });
  it('returns undefined for an authorless paper so the field is omitted', () => {
    expect(bibtexAuthors(makePaper({ authors: [] }))).toBeUndefined();
  });
});

describe('normalizeBibtexPages', () => {
  it('converts numeric single hyphens into BibTeX double hyphens', () => {
    expect(normalizeBibtexPages('5998-6008')).toBe('5998--6008');
  });
  it('leaves already-double and non-numeric input alone', () => {
    expect(normalizeBibtexPages('12--18')).toBe('12--18');
    expect(normalizeBibtexPages('iv--xii')).toBe('iv--xii');
  });
});

describe('escapeBibtexValue', () => {
  it('escapes braces, percent, ampersand, hash, underscore', () => {
    expect(escapeBibtexValue('a{b}c%d&e#f_g')).toBe('a\\{b\\}c\\%d\\&e\\#f\\_g');
  });
  it('escapes backslashes before anything else so escaping does not double up', () => {
    expect(escapeBibtexValue('\\emph{x}')).toBe('\\\\emph\\{x\\}');
  });
});

describe('papersToBibtex — determinism and header', () => {
  it('prepends the generated-header marker', () => {
    expect(papersToBibtex([])).toBe(`${BIBTEX_GENERATED_HEADER}\n\n\n`);
  });

  it('sorts entries by citekey case-insensitively, regardless of input order', () => {
    const a = makePaper({ citekey: 'zola_1898_jaccuse', title: 'A', authors: ['Zola'], year: 1898 });
    const b = makePaper({ citekey: 'adams_1979_galaxy', title: 'B', authors: ['Adams'], year: 1979 });
    expect(papersToBibtex([a, b])).toBe(papersToBibtex([b, a]));
    const out = papersToBibtex([a, b]);
    expect(out.indexOf('@article{adams_1979_galaxy')).toBeLessThan(out.indexOf('@article{zola_1898_jaccuse'));
  });

  it('is byte-identical across repeated exports (stable diff surface)', () => {
    const papers = [
      makePaper(),
      makePaper({ citekey: 'vaswani_2017_attention', year: 2017, volume: '30' }),
    ];
    expect(papersToBibtex(papers)).toBe(papersToBibtex(papers));
  });
});

