// tests/project-stats.test.ts
//
// Regression tests for the Slice 0 stats fix in `ProjectManager`:
// `getProjectPapers` now reads the canonical `PaperService` index instead of
// fabricating filename stubs — every stub was hard-coded to
// `status: 'unread'`, so `getProjectStats`'s per-status breakdown never
// matched reality.

import { describe, expect, it } from 'vitest';
import type { Paper, Project } from '../src/types';
import { READING_STATUSES } from '../src/types';
import { ProjectManager } from '../src/services/project-manager';
import type { ResearchVaultPlugin } from '../src/core/plugin';

function makeProject(): Project {
  return {
    id: 'p-1',
    name: 'Thesis',
    folderPath: 'proj',
    createdAt: 0,
    updatedAt: 0,
    isActive: true,
    settings: {
      paperTemplate: 'default',
      noteTemplate: 'default',
      citationStyle: 'apa',
      autoExtractMetadata: false,
      excludedFolders: [],
      customFields: [],
    },
  };
}

function makePaper(status: Paper['status'], citekey = 'smith_2023_test'): Paper {
  return {
    id: `p-1/${citekey}`,
    citekey,
    title: `Paper ${citekey}`,
    authors: ['Smith'],
    year: 2023,
    keywords: [],
    status,
    priority: 'normal',
    dateAdded: 0,
    dateModified: 0,
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: { projectId: 'p-1' },
    source: 'manual',
  };
}

function makeHarness(papers: Paper[]) {
  const project = makeProject();
  const plugin = {
    settings: { projects: [project] },
    paperService: {
      getInProject: (projectId: string): Paper[] =>
        projectId === project.id ? papers : [],
    },
    app: { vault: { getAbstractFileByPath: () => undefined } },
  } as unknown as ResearchVaultPlugin;
  return { manager: new ProjectManager(plugin), project };
}

describe('ProjectManager.getProjectPapers / getProjectStats — Slice 0 fix', () => {
  it('reports real reading statuses from the canonical paper store', () => {
    const papers = [
      makePaper('reading'),
      makePaper('reading', 'jones_2022_other'),
      makePaper('synthesized', 'lee_2021_third'),
    ];
    const { manager, project } = makeHarness(papers);

    expect(manager.getProjectPapers(project.id)).toEqual(papers);
    const stats = manager.getProjectStats(project.id);
    expect(stats.totalPapers).toBe(3);
    expect(stats.papersByStatus.reading).toBe(2);
    expect(stats.papersByStatus.synthesized).toBe(1);
    // Every other status bucket stays at zero — previously all three papers
    // landed in `unread` regardless of their frontmatter.
    for (const status of READING_STATUSES) {
      if (status !== 'reading' && status !== 'synthesized') {
        expect(stats.papersByStatus[status]).toBe(0);
      }
    }
  });

  it('falls back to an empty result before the index is hydrated', () => {
    const { manager, project } = makeHarness([]);

    expect(manager.getProjectPapers(project.id)).toEqual([]);
    const stats = manager.getProjectStats(project.id);
    expect(stats.totalPapers).toBe(0);
    expect(stats.papersByStatus.unread).toBe(0);
  });

  it('throws for an unknown project id', () => {
    const { manager } = makeHarness([]);
    expect(() => manager.getProjectStats('nope')).toThrow('Project not found');
    expect(() => manager.getProjectPapers('nope')).toThrow('Project not found');
  });
});