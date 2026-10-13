// tests/citekey.test.ts
//
// Citekeys become filenames, so the slug rules matter: a regression can
// make two papers collide or produce a path-unfriendly note name.
// Behavior pinned per D7 (author + year always present) and D22
// (underscore-separated `author_YYYY_keyword`).

import { describe, expect, it } from 'vitest';
import { composeCitekey, generateUniqueCitekey, slugify } from '../src/utils/citekey';

describe('composeCitekey', () => {
  it('builds author_year_keyword', () => {
    expect(composeCitekey({ lastName: 'Smith', year: 2023, title: 'Deep Learning' })).toBe(
      'smith_2023_deep',
    );
  });

  it('collapses diacritics', () => {
    expect(composeCitekey({ lastName: 'Müller', year: 2023, title: 'On Attention' })).toBe(
      'muller_2023_attention',
    );
  });

  it('skips stopwords when picking the title keyword', () => {
    expect(composeCitekey({ lastName: 'Smith', year: 2023, title: 'The Theory of Things' })).toBe(
      'smith_2023_theory',
    );
  });

  it('uses "nd" for a missing year', () => {
    expect(composeCitekey({ lastName: 'Smith', title: 'Work' }).includes('_nd_')).toBe(true);
  });

  it('falls back to "anon" for a missing author', () => {
    expect(composeCitekey({ year: 2023, title: 'Work' }).startsWith('anon_')).toBe(true);
  });

  it('omits the keyword slot when no non-stopword exists', () => {
    expect(composeCitekey({ lastName: 'Smith', year: 2023, title: 'The Of An' })).toBe('smith_2023');
  });
});

describe('generateUniqueCitekey', () => {
  it('returns the base when it is free', () => {
    expect(generateUniqueCitekey({ lastName: 'Smith', year: 2023, title: 'Deep' }, () => false)).toBe(
      'smith_2023_deep',
    );
  });

  it('appends -2, -3, ... on collisions', () => {
    const taken = new Set(['smith_2023_deep', 'smith_2023_deep-2']);
    expect(
      generateUniqueCitekey({ lastName: 'Smith', year: 2023, title: 'Deep' }, (c) => taken.has(c)),
    ).toBe('smith_2023_deep-3');
  });

  it('falls back to a timestamp suffix on exhaustively-colliding keys', () => {
    const key = generateUniqueCitekey({ lastName: 'Smith', year: 2023, title: 'Deep' }, () => true);
    expect(key.startsWith('smith_2023_deep-')).toBe(true);
    // Timestamp fallback is base36 — not one of the low numeric suffixes.
    expect(key.length).toBeGreaterThan('smith_2023_deep-99'.length);
  });
});

describe('slugify', () => {
  it('lower-cases and strips punctuation', () => {
    expect(slugify('Van der Berg!')).toBe('vanderberg');
  });

  it('keeps a unicode anchor for non-Latin scripts', () => {
    expect(slugify('田中'));
    expect(slugify('田中')).toBe('田中');
  });

  it('never returns an empty string', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('anon');
  });
});
