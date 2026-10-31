// tests/vault-indexer.test.ts
//
// 1.1.3.A.2 — `VaultIndexer.searchPapers` must scope the candidate set to
// `filters.projectId` BEFORE fuzzy scoring. Acceptance:
// - a paper in another project never enters the candidate set (proven by
//   recording every string handed to the fuzzy matcher)
// - scoped ordering equals unscoped ordering filtered to that project
// - an empty query with a projectId returns only that project, in the
//   indexer's stable order
// - unscoped search keeps today's ordering
//
// The `obsidian` alias points at `tests/mocks/obsidian.ts`, which has no
// fuzzy matcher, so this file mocks the module with a deterministic
// subsequence matcher (the real API's score is <= 0, closer to 0 = better).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fuzzyCalls = vi.hoisted(() => ({ texts: [] as string[] }));

vi.mock('obsidian', () => {
  const prepareFuzzySearch = (query: string) => {
    const needle = query.toLowerCase();
    return (text: string) => {
      fuzzyCalls.texts.push(text);
      const haystack = text.toLowerCase();
      if (needle.length === 0) return { score: 0, matches: [] };
      const matches: Array<[number, number]> = [];
      let from = 0;
      for (const char of needle) {
        const at = haystack.indexOf(char, from);
        if (at === -1) return null;
        matches.push([at, at + 1]);
        from = at + 1;
      }
      const first = matches[0];
      const last = matches[matches.length - 1];
      if (!first || !last) return null;
      const span = last[0] - first[0] + 1;
      return { score: -Math.max(0, span - needle.length), matches };
    };
  };
  return { prepareFuzzySearch };
});

import { VaultIndexer } from '../src/services/vault-indexer';
import type { Paper } from '../src/types';
import type { ResearchVaultPlugin } from '../src/core/plugin';

interface SeedPaper {
  id: string;
  projectId: string;
  title: string;
  dateAdded: number;
  citekey?: string;
  authors?: string[];
  keywords?: string[];
  venue?: string;
}

function makePaper({
  id,
  projectId,
  title,
  dateAdded,
  citekey = id,
  authors = ['Doe'],
  keywords = [],
  venue = '',
}: SeedPaper): Paper {
  return {
    id,
    citekey,
    title,
    authors,
    year: 2024,
    venue,
    keywords,
    status: 'unread',
    priority: 'normal',
    dateAdded,
    dateModified: dateAdded,
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: { projectId },
    source: 'manual',
  };
}

function makeIndexer(papers: Paper[]): VaultIndexer {
  const plugin = {
    paperService: { getAll: (): Paper[] => papers },
    eventBus: { on: (): (() => void) => () => {}, emit: (): void => {} },
  } as unknown as ResearchVaultPlugin;
  const indexer = new VaultIndexer(plugin);
  indexer.hydrate();
  return indexer;
}

beforeEach(() => {
  fuzzyCalls.texts.length = 0;
});

describe('VaultIndexer.searchPapers — project scoping (1.1.3.A.2)', () => {
  it('never scores a paper from another project when projectId is set', () => {
    const p1 = makePaper({
      id: 'p1/alpha',
      projectId: 'p1',
      title: 'Alpha beta',
      citekey: 'AlphaSmith',
      authors: ['Alpha Doe'],
      keywords: ['alpha'],
      dateAdded: 3000,
    });
    const p2 = makePaper({
      id: 'p2/rival',
      projectId: 'p2',
      title: 'Alpha rival',
      citekey: 'AlphaJones',
      authors: ['Alpha Jones'],
      keywords: ['alpha'],
      venue: 'Alpha Journal',
      dateAdded: 2500,
    });
    const indexer = makeIndexer([p1, p2]);

    // The rival genuinely matches: unscoped search returns both.
    expect(indexer.searchPapers('alpha').map((p) => p.id)).toEqual([
      'p1/alpha',
      'p2/rival',
    ]);

    fuzzyCalls.texts.length = 0;
    expect(indexer.searchPapers('alpha', { projectId: 'p1' }).map((p) => p.id)).toEqual([
      'p1/alpha',
    ]);

    // Candidate-set proof: none of the other project's fields were scored.
    for (const text of ['Alpha rival', 'AlphaJones', 'Alpha Jones', 'Alpha Journal']) {
      expect(fuzzyCalls.texts).not.toContain(text);
    }
  });

  it('scoped ordering equals unscoped ordering filtered to the project', () => {
    const indexer = makeIndexer([
      makePaper({ id: 'p1/net', projectId: 'p1', title: 'neural net', dateAdded: 5 }),
      makePaper({ id: 'p2/code', projectId: 'p2', title: 'neural code', dateAdded: 3 }),
      makePaper({ id: 'p1/graph', projectId: 'p1', title: 'neural graph', dateAdded: 10 }),
    ]);

    const scoped = indexer.searchPapers('neural', { projectId: 'p1' });
    const unscopedProj1 = indexer
      .searchPapers('neural')
      .filter((p) => p.customFields['projectId'] === 'p1');

    expect(scoped.map((p) => p.id)).toEqual(['p1/graph', 'p1/net']);
    expect(scoped.map((p) => p.id)).toEqual(unscopedProj1.map((p) => p.id));
  });

  it('empty query with projectId returns only that project, in stable order', () => {
    const indexer = makeIndexer([
      makePaper({ id: 'p1/a', projectId: 'p1', title: 'T1', dateAdded: 10 }),
      makePaper({ id: 'p2/b', projectId: 'p2', title: 'T2', dateAdded: 30 }),
      makePaper({ id: 'p1/c', projectId: 'p1', title: 'T3', dateAdded: 20 }),
    ]);

    expect(indexer.searchPapers('', { projectId: 'p1' }).map((p) => p.id)).toEqual([
      'p1/c',
      'p1/a',
    ]);
    expect(indexer.searchPapers('', { projectId: 'missing' })).toEqual([]);
  });

  it('unscoped search keeps its score/date/title ordering', () => {
    const indexer = makeIndexer([
      makePaper({ id: 'p1/ml', projectId: 'p1', title: 'machine learning', dateAdded: 1 }),
      makePaper({ id: 'p2/mv', projectId: 'p2', title: 'machine vision', dateAdded: 2 }),
    ]);

    expect(indexer.searchPapers('machine').map((p) => p.id)).toEqual(['p2/mv', 'p1/ml']);
    expect(indexer.searchPapers('').map((p) => p.id)).toEqual(['p2/mv', 'p1/ml']);
    expect(indexer.searchPapers('', { projectId: undefined }).map((p) => p.id)).toEqual([
      'p2/mv',
      'p1/ml',
    ]);
  });
});
