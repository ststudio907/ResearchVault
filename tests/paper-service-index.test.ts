// tests/paper-service-index.test.ts
//
// 1.1.3.A.1 — tests for the per-project membership index behind
// `PaperService.getInProject`. Acceptance:
// - 3 projects × N papers -> only that project's, in insertion order, after a
//   full hydrate (and hydrate is idempotent)
// - deletePaper removes the id from the project set
// - a project move via updatePaper drops the id from the OLD set first
//
// The harness fakes the vault surface `hydrate()` uses (`getAbstractFileByPath`,
// `metadataCache`, `cachedRead`) with the same structural-fake approach as the
// other paper-service tests, so the real service code runs.

import { describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import type { Paper } from '../src/types';
import { PaperService } from '../src/services/paper-service';
import type { ResearchVaultPlugin } from '../src/core/plugin';
import type { ProjectManager } from '../src/services/project-manager';
import { joinFrontmatter } from '../src/utils/frontmatter';
import { toFrontmatter } from '../src/services/papers/paper-file-format';

const PROJECT_IDS = ['p1', 'p2', 'p3'] as const;

interface SeedPaper {
  projectId: string;
  citekey: string;
}

function makePaper({ projectId, citekey }: SeedPaper): Paper {
  return {
    id: `${projectId}/${citekey}`,
    citekey,
    title: `Paper ${citekey}`,
    authors: ['Doe'],
    year: 2024,
    keywords: [],
    status: 'unread',
    priority: 'normal',
    dateAdded: new Date(2024, 0, 1).getTime(),
    dateModified: new Date(2024, 0, 2).getTime(),
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: { projectId, papersFolder: `projects/${projectId}/papers` },
    source: 'manual',
  };
}

function folderPath(projectId: string): string {
  return `projects/${projectId}/papers`;
}

function makeHarness(seeds: SeedPaper[]) {
  const folders = new Map<string, TFolder>();
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>();

  for (const projectId of PROJECT_IDS) {
    const folder = new TFolder();
    folder.path = folderPath(projectId);
    folders.set(folder.path, folder);
  }

  for (const seed of seeds) {
    const folder = folders.get(folderPath(seed.projectId));
    if (!folder) throw new Error(`missing folder for ${seed.projectId}`);
    const file = new TFile();
    file.path = `${folder.path}/${seed.citekey}.md`;
    file.basename = seed.citekey;
    file.extension = 'md';
    (file as unknown as { parent: TFolder }).parent = folder;
    folder.children.push(file);
    files.set(file.path, file);
    contents.set(file.path, joinFrontmatter(toFrontmatter(makePaper(seed)), ''));
  }

  const vault = {
    getAbstractFileByPath: (path: string): TFile | TFolder | null =>
      folders.get(path) ?? files.get(path) ?? null,
    cachedRead: vi.fn(async (file: TFile): Promise<string> => contents.get(file.path) ?? ''),
    create: vi.fn(async (path: string, data: string): Promise<TFile> => {
      const file = new TFile();
      file.path = path;
      file.basename = path.split('/').pop()!.replace(/\.md$/u, '');
      file.extension = 'md';
      files.set(path, file);
      contents.set(path, data);
      return file;
    }),
    process: vi.fn(async (file: TFile, fn: (data: string) => string): Promise<string> => {
      const current = contents.get(file.path);
      if (current === undefined) throw new Error('File does not exist.');
      const next = fn(current);
      contents.set(file.path, next);
      return next;
    }),
  };

  const plugin = {
    eventBus: { on: () => () => {}, emit: () => {}, clear: () => {} },
    app: { vault, metadataCache: { getFileCache: () => null } },
    settings: {
      projects: PROJECT_IDS.map((id) => ({ id, settings: {} })),
      pdfLibraryFolder: 'pdfs',
      templates: { paper: '' },
    },
  } as unknown as ResearchVaultPlugin;
  const projectManager = {
    getProjectPapersFolder: (projectId: string): string => folderPath(projectId),
  } as unknown as ProjectManager;

  return { service: new PaperService(plugin, projectManager), contents, files };
}

const SEEDS: SeedPaper[] = [
  { projectId: 'p1', citekey: 'a1' },
  { projectId: 'p1', citekey: 'a2' },
  { projectId: 'p2', citekey: 'b1' },
  { projectId: 'p2', citekey: 'b2' },
  { projectId: 'p2', citekey: 'b3' },
  { projectId: 'p3', citekey: 'c1' },
];

describe('PaperService.getInProject — per-project index', () => {
  it('returns only that project, in insertion order, after a full hydrate', async () => {
    const { service } = makeHarness(SEEDS);
    await service.hydrate();

    expect(service.getAll()).toHaveLength(SEEDS.length);
    expect(service.getInProject('p1').map((p) => p.citekey)).toEqual(['a1', 'a2']);
    expect(service.getInProject('p2').map((p) => p.citekey)).toEqual(['b1', 'b2', 'b3']);
    expect(service.getInProject('p3').map((p) => p.citekey)).toEqual(['c1']);
    expect(service.getInProject('missing')).toEqual([]);

    // Invariant: the project set's order is exactly getAll()'s insertion order.
    for (const projectId of PROJECT_IDS) {
      const expected = service
        .getAll()
        .filter((p) => p.customFields['projectId'] === projectId)
        .map((p) => p.id);
      expect(service.getInProject(projectId).map((p) => p.id)).toEqual(expected);
    }
  });

  it('is idempotent across repeated hydrates (no stale/duplicated membership)', async () => {
    const { service } = makeHarness(SEEDS);
    await service.hydrate();
    await service.hydrate();

    expect(service.getAll()).toHaveLength(SEEDS.length);
    expect(service.getInProject('p2').map((p) => p.citekey)).toEqual(['b1', 'b2', 'b3']);
  });

  it('deletePaper removes the id from its project set', async () => {
    const { service } = makeHarness(SEEDS);
    await service.hydrate();
    const target = service.getInProject('p2')[1];
    expect(target?.citekey).toBe('b2');

    await service.deletePaper(target!.id, { deleteFile: false });

    expect(service.getInProject('p2').map((p) => p.citekey)).toEqual(['b1', 'b3']);
    expect(service.getInProject('p1').map((p) => p.citekey)).toEqual(['a1', 'a2']);
    expect(service.getInProject('p3').map((p) => p.citekey)).toEqual(['c1']);
  });

  it('a project move via updatePaper leaves the old set clean', async () => {
    const { service } = makeHarness(SEEDS);
    await service.hydrate();
    const target = service.getInProject('p1')[0];
    expect(target?.citekey).toBe('a1');

    const moved = await service.updatePaper(target!.id, {
      customFields: { projectId: 'p2', papersFolder: folderPath('p2') },
    });

    expect(moved.customFields['projectId']).toBe('p2');
    expect(service.getInProject('p1').map((p) => p.citekey)).toEqual(['a2']);
    expect(service.getInProject('p2').map((p) => p.id)).toContain(target!.id);
    expect(service.getInProject('p2').map((p) => p.citekey)).toEqual(['b1', 'b2', 'b3', 'a1']);
  });
});
