// tests/citeproc-engine.test.ts
//
// C3.3 — the bundled citeproc-js boundary, exercised against the *real*
// vendored styles and locale (inflated through the production path).
//
// Needs a DOM: citeproc-js picks its XML processor from the global
// `DOMParser` at load, which node alone does not provide — hence the jsdom
// environment pragma. This mirrors the Obsidian renderer, where DOMParser
// always exists.

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';
import { inflateGzipBase64 } from '../src/services/citation/csl-inflate';
import {
  CiteprocRenderer,
  CiteprocRenderError,
} from '../src/services/citation/citeproc-engine';
import { paperToCslJson } from '../src/services/citation/paper-to-csl';
import type { Paper } from '../src/types';

let apaXml = '';
let ieeeXml = '';
let localeXml = '';

beforeAll(async () => {
  const { CSL_BUNDLED, CSL_LOCALES } = await import(
    '../src/services/citation/csl-bundle.generated'
  );
  apaXml = await inflateGzipBase64(CSL_BUNDLED['apa'] ?? '');
  ieeeXml = await inflateGzipBase64(CSL_BUNDLED['ieee'] ?? '');
  localeXml = await inflateGzipBase64(CSL_LOCALES['en-US'] ?? '');
  // Sanity: the production inflate path really produced CSL XML.
  expect(apaXml).toContain('<style');
  expect(ieeeXml).toContain('<style');
  expect(localeXml).toContain('<locale');
});

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'proj1/smith_2020',
    citekey: 'smith_2020',
    title: 'Learning deep representations',
    authors: ['Smith', 'Jones'],
    authorFirstNames: ['Jane', 'Bob'],
    year: 2020,
    venue: 'Journal of Testing',
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

function makeRenderer(papers: Paper[], styleXml = apaXml): CiteprocRenderer {
  const items: Record<string, unknown> = {};
  for (const paper of papers) items[paper.citekey] = paperToCslJson(paper);
  return new CiteprocRenderer(items, styleXml, localeXml);
}

const smith = makePaper({ citekey: 'smith_2020' });
const jones = makePaper({
  citekey: 'jones_2019',
  id: 'proj1/jones_2019',
  title: 'Deep Learning Foundations',
  authors: ['Jones'],
  authorFirstNames: ['Alice'],
  year: 2019,
  entryType: 'book',
  publisher: 'Academic Press',
  venue: undefined,
});

describe('CiteprocRenderer (bundled citeproc, real styles)', () => {
  it('renders a parenthetical group exactly as pandoc does (APA)', () => {
    const renderer = makeRenderer([smith, jones]);
    expect(renderer.renderGroups([{ keys: ['smith_2020', 'jones_2019'], narrative: false }]))
      .toContain('(Jones, 2019; Smith & Jones, 2020)');
  });

  it('renders the narrative @key form as author names + year tail (APA)', () => {
    const renderer = makeRenderer([smith]);
    expect(renderer.renderGroups([{ keys: ['smith_2020'], narrative: true }]))
      .toContain('Smith & Jones (2020)');
  });

  it('keeps first-vs-subsequent forms correct across document order', () => {
    const renderer = makeRenderer([smith]);
    const rendered = renderer.renderGroups([
      { keys: ['smith_2020'], narrative: false },
      { keys: ['smith_2020'], narrative: false },
    ]);
    expect(rendered[0]).toBe('(Smith & Jones, 2020)');
    // The second citation of the same paper stays a valid APA in-text form;
    // the engine saw both in document order.
    expect(rendered[1]).toBe('(Smith & Jones, 2020)');
  });

  it('renders plain numeric citations under IEEE and drops the author-only half', () => {
    const renderer = makeRenderer([smith], ieeeXml);
    const rendered = renderer.renderGroups([
      { keys: ['smith_2020'], narrative: false },
      { keys: ['smith_2020'], narrative: true },
    ]);
    expect(rendered[0]).toBe('[1]');
    // IEEE has no author-only printed form ([NO_PRINTED_FORM]) — the
    // narrative form must be the bare number, matching pandoc's output.
    expect(rendered[1]).toBe('[1]');
  });

  it('throws a CiteprocRenderError naming the unknown key instead of crashing', () => {
    const renderer = makeRenderer([smith]);
    expect(() =>
      renderer.renderGroups([{ keys: ['nope_9999'], narrative: false }]),
    ).toThrow(CiteprocRenderError);
  });

  it('renders empty output for an empty group list', () => {
    const renderer = makeRenderer([smith]);
    expect(renderer.renderGroups([])).toEqual([]);
  });
});
