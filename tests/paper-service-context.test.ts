// tests/paper-service-context.test.ts
//
// 1.1 Slice 2c (context awareness): tests for `PaperService.getPaperByPath`,
// the O(1) resolver behind the plugin's active-leaf tracking. The service
// only needs `byId` / `pathToId` seeded (no vault I/O on this path), so the
// structural-fake harness from `paper-service-addquote.test.ts` is reused
// in a reduced form.
//
// Covered behaviours:
// - exact path hit via the lowercase reverse index
// - case-insensitive match (Obsidian normalises paths; the index stores
//   lower-cased keys, so a user-navigated path must resolve regardless)
// - basename fallback when the reverse index has no entry but the note
//   sits in the paper's recorded papers folder
// - basename fallback refusing a matching citekey in the WRONG folder
//   (citekeys repeat across projects; the folder guard is the disambiguator)
// - miss for non-paper paths

import { describe, expect, it } from 'vitest';
import type { Paper } from '../src/types';
import { PaperService } from '../src/services/paper-service';
import type { ResearchVaultPlugin } from '../src/core/plugin';
import type { ProjectManager } from '../src/services/project-manager';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'p-1/smith_2023_test',
    citekey: 'smith_2023_test',
    title: 'Attention Is All You Test',
    authors: ['Smith'],
    year: 2023,
    keywords: [],
    status: 'reading',
    priority: 'normal',
    dateAdded: new Date(2023, 5, 15, 10, 0).getTime(),
    dateModified: new Date(2024, 0, 20, 12, 30).getTime(),
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: { projectId: 'p-1', papersFolder: 'proj/papers' },
    source: 'manual',
    ...overrides,
  };
}

interface Seed {
  paper: Paper;
  /** Canonical note path recorded in the reverse index (lower-cased). */
  indexedPath?: string;
}

function makeService(seeds: Seed[]): PaperService {
  const plugin = {
    eventBus: { on: () => () => {}, emit: () => {}, clear: () => {} },
    app: { vault: {} },
    settings: { projects: [] },
  } as unknown as ResearchVaultPlugin;
  const service = new PaperService(plugin, {} as ProjectManager);
  const internals = service as unknown as {
    byId: Map<string, Paper>;
    pathToId: Map<string, string>;
  };
  for (const { paper, indexedPath } of seeds) {
    internals.byId.set(paper.id, paper);
    if (indexedPath !== undefined) {
      internals.pathToId.set(indexedPath.toLowerCase(), paper.id);
    }
  }
  return service;
}

describe('PaperService.getPaperByPath — context-awareness resolver', () => {
  it('resolves a paper from its exact canonical path', () => {
    const paper = makePaper();
    const service = makeService([{ paper, indexedPath: 'proj/papers/smith_2023_test.md' }]);

    expect(service.getPaperByPath('proj/papers/smith_2023_test.md')).toBe(paper);
  });

  it('resolves case-insensitively, as Obsidian presents paths to the user', () => {
    const paper = makePaper();
    const service = makeService([{ paper, indexedPath: 'proj/papers/smith_2023_test.md' }]);

    expect(service.getPaperByPath('Proj/Papers/Smith_2023_Test.md')).toBe(paper);
  });

  it('falls back to basename + folder when the reverse index has no entry', () => {
    // Note moved between folders: the reverse index still holds the OLD
    // location (until the rename handler runs), but the paper record points
    // at `proj/papers`, so the fallback must still find it.
    const paper = makePaper();
    const service = makeService([{ paper, indexedPath: 'elsewhere/old.md' }]);

    expect(service.getPaperByPath('proj/papers/smith_2023_test.md')).toBe(paper);
  });

  it('refuses the basename fallback when the folder does not match', () => {
    // Same citekey in a different project's papers folder is a DIFFERENT
    // paper (citekeys repeat across projects). No index entry for the
    // foreign path, and the folder guard must reject it.
    const paper = makePaper();
    const service = makeService([{ paper, indexedPath: 'proj/papers/smith_2023_test.md' }]);

    expect(service.getPaperByPath('other/papers/smith_2023_test.md')).toBeUndefined();
  });

  it('returns undefined for paths that are not paper notes', () => {
    const paper = makePaper();
    const service = makeService([{ paper, indexedPath: 'proj/papers/smith_2023_test.md' }]);

    expect(service.getPaperByPath('proj/notes/synthesis.md')).toBeUndefined();
    expect(service.getPaperByPath('')).toBeUndefined();
  });
});
