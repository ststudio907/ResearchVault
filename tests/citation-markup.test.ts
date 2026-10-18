// tests/citation-markup.test.ts
//
// Unit tests for the pure citation-markup scanner
// (src/services/citation/citation-markup.ts). This matcher decides which
// bits of a note the reading-view renderer turns into links, so false
// positives (linking prose) and false negatives (missing a real citation)
// are equally bad — hence the boundary coverage.

import { describe, expect, it } from 'vitest';
import {
  CITATION_KEY_PATTERN,
  findCitationMatches,
  formatCitationMarkup,
  locateKeysInBlock,
} from '../src/services/citation/citation-markup';

describe('findCitationMatches', () => {
  it('finds a single key with correct offsets', () => {
    const text = 'As shown recently [@smith2024attention] the model';
    const matches = findCitationMatches(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      start: 18, // 'As shown recently ' is 18 chars
      end: 18 + '[@smith2024attention]'.length,
      block: '[@smith2024attention]',
    });
  });

  it('matches multi-key groups separated by semicolons', () => {
    const matches = findCitationMatches('see [@a2019; @b2020-paper]');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.block).toBe('[@a2019; @b2020-paper]');
  });

  it('finds multiple disjoint blocks in one text', () => {
    const text = '[@a2019] and later [@b2020]';
    const matches = findCitationMatches(text);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ start: 0, end: 8 });
    expect(matches[1]?.start).toBe(19);
  });

  it('ignores non-citation bracket prose', () => {
    for (const text of [
      '[a link](https://x)',
      '[@] empty',
      'no brackets at all',
      '[@ key] space after bracket',
    ]) {
      expect(findCitationMatches(text)).toHaveLength(0);
    }
  });

  it('does not leak outside the citekey charset (underscore stops the match)', () => {
    // Pandoc would allow `_` in keys, but we only ever *recognize* keys in
    // the charset composeCitekey() can emit — foreign markup stays inert.
    expect(findCitationMatches('[@key_extra]')).toHaveLength(0);
  });

  it('matches the bare inline narrative form (what Shift+Enter inserts)', () => {
    const text = 'As @vaswani2017attention show, scale is the trick';
    const matches = findCitationMatches(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ start: 3, block: '@vaswani2017attention' });
  });

  it('does not double-match keys already inside a bracketed block', () => {
    const matches = findCitationMatches('[@a2019; @b2020-paper] and @c2021 inline');
    expect(matches).toHaveLength(2);
    expect(matches[0]?.block).toBe('[@a2019; @b2020-paper]');
    expect(matches[1]).toMatchObject({ block: '@c2021', start: 27 });
  });

  it('refuses emails and URL user paths', () => {
    const text = 'Mail user@gmail.com or https://x.com/@handle';
    expect(findCitationMatches(text)).toHaveLength(0);
  });

  it('treats [[@key]] wikilink-wrapped citations as real citations', () => {
    // The inner `[@key]` is genuinely valid Pandoc markup regardless of the
    // Obsidian brackets around it, so it matches (and resolves) as a normal
    // bracketed block.
    const matches = findCitationMatches('see [[@notcitation]]');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.block).toBe('[@notcitation]');
  });

  it('treats plain @handle prose as an unresolved candidate by design', () => {
    // Pandoc itself would try to resolve it; the renderer mutes misses, so
    // matching here is honest rather than noisy. Locked in intentionally.
    const matches = findCitationMatches('Ping @someone about it');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.block).toBe('@someone');
  });
});

describe('locateKeysInBlock', () => {
  it('locates each key inside a block, preserving separators as prose', () => {
    const block = '[@a2019; @b2020-x]';
    const keys = locateKeysInBlock(block);
    expect(keys).toEqual([
      { key: 'a2019', start: 1, end: 7 },
      { key: 'b2020-x', start: 9, end: 17 },
    ]);
  });
});

describe('formatCitationMarkup (D35 amended — insert forms)', () => {
  it('emits parenthetical and inline Pandoc forms', () => {
    expect(formatCitationMarkup('vaswani2017attention', 'parenthetical')).toBe(
      '[@vaswani2017attention]',
    );
    expect(formatCitationMarkup('vaswani2017attention', 'inline')).toBe('@vaswani2017attention');
  });
});

describe('CITATION_KEY_PATTERN', () => {
  it('matches the composeCitekey charset exactly', () => {
    expect(CITATION_KEY_PATTERN.test('smith2024attention')).toBe(true);
    expect(CITATION_KEY_PATTERN.test('a-b-9')).toBe(true);
    expect(CITATION_KEY_PATTERN.test('-leading')).toBe(false);
    expect(CITATION_KEY_PATTERN.test('has_underscore')).toBe(false);
    expect(CITATION_KEY_PATTERN.test('has space')).toBe(false);
    expect(CITATION_KEY_PATTERN.test('')).toBe(false);
  });
});
