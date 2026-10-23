// tests/synthesis-service.test.ts
//
// Regression tests for the 1.1 Slice 1 synthesis service: atomic creation,
// staged evidence-block mutation (index + event only on successful disk
// write), removal, and hydration round-trip from the note body.
//
// Same structural-fake harness as `paper-service-addquote.test.ts`: the
// service only touches `eventBus` and `app.vault` on these paths, and the
// private `byId` index is seeded directly.

import { describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import type { SynthesisNote } from '../src/types';
import { SynthesisService } from '../src/services/synthesis-service';
import {
  renderSynthesisBody,
  toSynthesisFrontmatter,
} from '../src/services/synthesis/synthesis-file-format';
import { joinFrontmatter, splitFrontmatter } from '../src/utils/frontmatter';
import type { ResearchVaultPlugin } from '../src/core/plugin';
import type { ProjectManager } from '../src/services/project-manager';

const FOLDER = 'proj/syntheses';
const PATH = `${FOLDER}/scalinglawshold.md`;

interface RecordedEvent { event: string; payload: unknown }

function makeNote(overrides: Partial<SynthesisNote> = {}): SynthesisNote {
  return {
    id: 'syn-1',
    projectId: 'p-1',
    title: 'Scaling laws hold',
    thesis: 'Bigger models win.',
    evidence: [],
    openQuestions: [],
    path: PATH,
    dateAdded: new Date(2026, 9, 19, 10, 0).getTime(),
    ...overrides,
  };
}

function fileFor(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.split('/').pop()!.replace(/\.md$/, '');
  file.stat = { ctime: 1000, mtime: 1000, size: 0 };
  return file;
}

function makeHarness(seed?: SynthesisNote) {
  const files = new Map<string, string>();
  const folders = new Map<string, TFolder>();

  const ensureFolder = (path: string): void => {
    if (folders.has(path)) return;
    const folder = new TFolder();
    folder.path = path;
    folders.set(path, folder);
  };

  const events: RecordedEvent[] = [];
  const eventBus = {
    on: () => () => {},
    emit: (event: string, payload: unknown): void => { events.push({ event, payload }); },
    clear: () => {},
  };

  const vault = {
    getAbstractFileByPath: (path: string): TFile | TFolder | null =>
      files.has(path) ? fileFor(path) : (folders.get(path) ?? null),
    createFolder: vi.fn(async (path: string): Promise<void> => { ensureFolder(path); }),
    create: vi.fn(async (path: string, data: string): Promise<TFile> => {
      files.set(path, data);
      return fileFor(path);
    }),
    process: vi.fn(async (file: TFile, fn: (data: string) => string): Promise<string> => {
      const current = files.get(file.path);
      if (current === undefined) throw new Error('File does not exist.');
      const next = fn(current);
      files.set(file.path, next);
      return next;
    }),
    cachedRead: vi.fn(async (file: TFile): Promise<string> => files.get(file.path) ?? ''),
  };

  const project = { id: 'p-1', folderPath: 'proj', name: 'Proj', isActive: true };
  const projectManager = {
    getProjectById: (id: string) => (id === 'p-1' ? project : undefined),
    getProjectSynthesesFolder: () => FOLDER,
    getProjectHubPath: () => 'proj/proj.md',
    ensureProjectFolders: vi.fn(async (): Promise<void> => { ensureFolder(FOLDER); }),
  };

  const plugin = {
    eventBus,
    app: { vault },
    settings: { projects: [project] },
  } as unknown as ResearchVaultPlugin;
  const service = new SynthesisService(plugin, projectManager as unknown as ProjectManager);

  if (seed) {
    const content = joinFrontmatter(toSynthesisFrontmatter(seed), renderSynthesisBody(seed));
    files.set(seed.path, content);
    (service as unknown as { byId: Map<string, SynthesisNote> }).byId.set(seed.id, seed);
  }

  return { service, files, folders, events, vault, projectManager };
}

function eventsNamed(events: RecordedEvent[], name: string): RecordedEvent[] {
  return events.filter((e) => e.event === name);
}

describe('SynthesisService.createSynthesis', () => {
  it('ensures the folder, writes the skeleton, indexes, and emits once', async () => {
    const h = makeHarness();

    const note = await h.service.createSynthesis('p-1', {
      title: 'Scaling laws hold',
      thesis: 'Bigger models win.',
      openQuestions: ['what about data quality?'],
    });

    expect(h.projectManager.ensureProjectFolders).toHaveBeenCalledWith('p-1');
    expect(h.vault.create).toHaveBeenCalledWith(PATH, expect.any(String));
    const content = h.files.get(PATH) ?? '';
    expect(content).toContain('type: synthesis');
    expect(content).toContain('projectId: p-1');
    expect(content).toContain('# Scaling laws hold');
    expect(content).toContain('Bigger models win.');
    expect(content).toContain('## Evidence');
    expect(content).toContain('- what about data quality?');

    expect(h.service.getById(note.id)?.path).toBe(PATH);
    expect(eventsNamed(h.events, 'synthesisCreated')).toHaveLength(1);
    expect(eventsNamed(h.events, 'synthesisUpdated')).toHaveLength(0);
  });

  it('deconflicts slugs with -2, -3, … on title collisions', async () => {
    const h = makeHarness();

    const first = await h.service.createSynthesis('p-1', { title: 'Scaling laws hold' });
    const second = await h.service.createSynthesis('p-1', { title: 'Scaling laws hold' });

    expect(first.path).toBe(PATH);
    expect(second.path).toBe(`${FOLDER}/scalinglawshold-2.md`);
    expect(h.files.has(second.path)).toBe(true);
    expect(eventsNamed(h.events, 'synthesisCreated')).toHaveLength(2);
  });

  it('refuses an empty title and an unknown project without writing', async () => {
    const h = makeHarness();
    await expect(h.service.createSynthesis('p-1', { title: '   ' })).rejects.toThrow(/title/);
    await expect(h.service.createSynthesis('nope', { title: 'x' })).rejects.toThrow(/not found/);
    expect(h.vault.create).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(0);
  });
});

describe('SynthesisService.addEvidence / removeEvidence', () => {
  it('persists the block, commits the index, and emits only on success', async () => {
    const seed = makeNote();
    const h = makeHarness(seed);

    const block = await h.service.addEvidence(seed.id, {
      citekey: 'smith_2023_test',
      text: 'Loss scales as a power law.',
      locator: '42',
      stance: 'supports',
    });

    const content = h.files.get(PATH) ?? '';
    expect(content).toContain('#### [@smith_2023_test] · p. 42');
    expect(content).toContain('> Loss scales as a power law.');
    expect(content).toContain('<!-- ev:'); // bare anchor footer
    expect(content).not.toContain('-- source:');
    expect(content).toContain('### Supports'); // stance lives in the group header
    expect(content).toContain('sources:'); // derived frontmatter list updated

    const indexed = h.service.getById(seed.id);
    expect(indexed?.evidence).toHaveLength(1);
    expect(indexed?.evidence[0]?.id).toBe(block.id);
    expect(indexed?.evidence[0]?.locator).toBe('42');

    expect(eventsNamed(h.events, 'synthesisUpdated')).toHaveLength(1);
    expect(h.service.consumeSelfWrite(PATH)).toBe(true);
  });

  it('rolls memory back and emits nothing when the disk write fails', async () => {
    const seed = makeNote();
    const h = makeHarness(seed);
    h.vault.process.mockRejectedValue(new Error('disk full'));

    await expect(
      h.service.addEvidence(seed.id, {
        citekey: 'smith_2023_test',
        text: 'lost block',
        stance: 'neutral',
      }),
    ).rejects.toThrow('disk full');

    expect(h.service.getById(seed.id)?.evidence).toHaveLength(0);
    expect(h.files.get(PATH)).not.toContain('lost block');
    expect(h.events).toHaveLength(0);
    expect(h.service.consumeSelfWrite(PATH)).toBe(false);
  });

  it('validates stance, text, citekey, and a missing file before writing', async () => {
    const seed = makeNote();
    const h = makeHarness(seed);
    h.files.delete(PATH); // index says the note exists, disk says otherwise

    await expect(h.service.addEvidence(seed.id, {
      citekey: 'smith_2023_test', text: 'x', stance: 'wrong' as never,
    })).rejects.toThrow(/stance/);
    await expect(h.service.addEvidence(seed.id, {
      citekey: 'smith_2023_test', text: '   ', stance: 'supports',
    })).rejects.toThrow(/text/);
    await expect(h.service.addEvidence(seed.id, {
      citekey: '   ', text: 'x', stance: 'supports',
    })).rejects.toThrow(/citekey/);
    await expect(h.service.addEvidence(seed.id, {
      citekey: 'smith_2023_test', text: 'x', stance: 'supports',
    })).rejects.toThrow(/missing/);
    expect(h.vault.process).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(0);
  });

  it('stores an empty-text block only when allowEmptyText is set (quick-add)', async () => {
    const seed = makeNote();
    const h = makeHarness(seed);

    const block = await h.service.addEvidence(seed.id, {
      citekey: 'smith_2023_test',
      text: '',
      stance: 'supports',
      allowEmptyText: true,
    });

    expect(block.text).toBe('');
    // The call-site flag is a transport hint, never persisted on the block.
    expect('allowEmptyText' in block).toBe(false);
    const content = h.files.get(PATH) ?? '';
    expect(content).toContain('#### [@smith_2023_test]');
    expect(content).toContain('<!-- ev:'); // bare anchor footer
    // Empty text renders as a bare blockquote line, which parses back empty.
    expect(h.service.getById(seed.id)?.evidence[0]?.text).toBe('');
    expect(eventsNamed(h.events, 'synthesisUpdated')).toHaveLength(1);
  });

  it('removes a block from disk and memory, and throws on unknown ids', async () => {
    const seed = makeNote({
      evidence: [{
        id: 'ev-1',
        citekey: 'smith_2023_test',
        text: 'Loss scales as a power law.',
        locator: '42',
        stance: 'supports',
        createdAt: 1,
      }],
    });
    const h = makeHarness(seed);

    await h.service.removeEvidence(seed.id, 'ev-1');

    expect(h.files.get(PATH)).not.toContain('ev-1');
    expect(h.files.get(PATH)).toContain('## Evidence'); // heading survives, emptied
    expect(h.service.getById(seed.id)?.evidence).toHaveLength(0);
    expect(eventsNamed(h.events, 'synthesisUpdated')).toHaveLength(1);

    await expect(h.service.removeEvidence(seed.id, 'ev-1')).rejects.toThrow(/not found/);
    expect(h.vault.process).toHaveBeenCalledTimes(1); // the failed lookup wrote nothing
  });
});

describe('SynthesisService.hydrate', () => {
  it('rebuilds the index from disk, parsing evidence blocks from the body', async () => {
    const h = makeHarness();
    const note = makeNote({
      evidence: [{
        id: 'ev-1',
        citekey: 'smith_2023_test',
        text: 'Loss scales as a power law.',
        locator: '42',
        stance: 'supports',
        createdAt: 1,
      }],
    });
    h.files.set(PATH, joinFrontmatter(toSynthesisFrontmatter(note), renderSynthesisBody(note)));
    const folder = new TFolder();
    folder.path = FOLDER;
    folder.children.push(fileFor(PATH));
    h.folders.set(FOLDER, folder);

    await h.service.hydrate();

    const hydrated = h.service.getById(note.id);
    expect(hydrated).not.toBeUndefined();
    expect(hydrated?.title).toBe('Scaling laws hold');
    expect(hydrated?.thesis).toBe('Bigger models win.');
    expect(hydrated?.evidence).toHaveLength(1);
    expect(hydrated?.evidence[0]).toMatchObject({
      id: 'ev-1',
      citekey: 'smith_2023_test',
      locator: '42',
      stance: 'supports',
      text: 'Loss scales as a power law.',
    });
    expect(h.service.getInProject('p-1')).toHaveLength(1);
  });

  it('skips files without required frontmatter instead of poisoning the index', async () => {
    const h = makeHarness();
    h.files.set(`${FOLDER}/stray.md`, '# just some note\n');
    const folder = new TFolder();
    folder.path = FOLDER;
    folder.children.push(fileFor(`${FOLDER}/stray.md`));
    h.folders.set(FOLDER, folder);

    await h.service.hydrate();

    expect(h.service.getAll()).toHaveLength(0);
  });

  it('hydrates the hub note stored at the project root (2a)', async () => {
    const h = makeHarness();
    const hub = makeNote({ path: 'proj/proj.md', hub: true });
    h.files.set(
      'proj/proj.md',
      joinFrontmatter(toSynthesisFrontmatter(hub), renderSynthesisBody(hub)),
    );
    // Only the syntheses/ folder exists as a TFolder; the hub file is found
    // by direct path lookup, so no folder entry is needed.
    const folder = new TFolder();
    folder.path = FOLDER;
    folder.children.push(fileFor(`${FOLDER}/empty.md`));
    h.folders.set(FOLDER, folder);

    await h.service.hydrate();

    const notes = h.service.getAll();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(hub.id);
    expect(notes[0]?.hub).toBe(true);
    expect(h.service.getHub('p-1')?.id).toBe(hub.id);
  });
});

describe('SynthesisService hub lifecycle (2a)', () => {
  const HUB = 'proj/proj.md';

  function writeHubFile(h: ReturnType<typeof makeHarness>, note: SynthesisNote, content?: string): void {
    h.files.set(
      HUB,
      content ?? joinFrontmatter(toSynthesisFrontmatter(note), renderSynthesisBody(note)),
    );
  }

  it('ensureHub creates the hub at the project root with the synthesis skeleton', async () => {
    const h = makeHarness();
    expect(h.service.getHub('p-1')).toBeUndefined();

    const hub = await h.service.ensureHub('p-1');
    expect(hub.path).toBe(HUB);
    expect(hub.hub).toBe(true);
    expect(hub.title).toBe('Proj');
    expect(eventsNamed(h.events, 'synthesisCreated')).toHaveLength(1);

    const raw = h.files.get(HUB) ?? '';
    expect(raw).toContain('hub: true');
    expect(raw).toContain('type: synthesis');
    expect(raw).toContain('# Proj');
    expect(raw).toContain('## Evidence');
    expect(raw).toContain('## Open questions');

    // Indexed for lookups from both directions.
    expect(h.service.getById(hub.id)?.hub).toBe(true);
    expect(h.service.getByPath(HUB)?.id).toBe(hub.id);
  });

  it('ensureHub is idempotent and returns the same note', async () => {
    const h = makeHarness();
    const first = await h.service.ensureHub('p-1');
    const second = await h.service.ensureHub('p-1');
    expect(second.id).toBe(first.id);
    expect(second.path).toBe(first.path);
    expect(eventsNamed(h.events, 'synthesisCreated')).toHaveLength(1);
  });

  it('ensureHub adopts a synthesis note already sitting at the hub path', async () => {
    const h = makeHarness();
    const adoptee = makeNote({ path: HUB });
    writeHubFile(h, adoptee);

    const hub = await h.service.ensureHub('p-1');
    expect(hub.id).toBe(adoptee.id);
    expect(hub.hub).toBe(true);
    expect(h.files.get(HUB)).toContain('hub: true');
    expect(eventsNamed(h.events, 'synthesisUpdated')).toHaveLength(1);
  });

  it('ensureHub refuses to clobber a non-synthesis file at the hub path', async () => {
    const h = makeHarness();
    h.files.set(HUB, '# my own MoC note\n');
    await expect(h.service.ensureHub('p-1')).rejects.toThrow(/not a synthesis note/);
    // The user's file is untouched.
    expect(h.files.get(HUB)).toBe('# my own MoC note\n');
    expect(h.events).toHaveLength(0);
  });

  it('ensureHub throws for an unknown project', async () => {
    const h = makeHarness();
    await expect(h.service.ensureHub('ghost')).rejects.toThrow(/not found/);
  });

  it('promoteToHub writes the flag without re-rendering the body', async () => {
    const seed = makeNote();
    const h = makeHarness(seed);
    const before = h.files.get(PATH) ?? '';
    // Hand-written prose outside the known sections must survive promotion.
    const withProse = `${before}## Aside\n\nHand-written.\n`;
    h.files.set(PATH, withProse);

    const promoted = await h.service.promoteToHub(seed.id);
    expect(promoted.hub).toBe(true);

    const after = h.files.get(PATH) ?? '';
    expect(after).toContain('hub: true');
    // Frontmatter-only edit: the pre-promotion body survives verbatim.
    expect(splitFrontmatter(after).body).toBe(splitFrontmatter(withProse).body);

    const seen = h.service.getById(seed.id);
    expect(seen?.hub).toBe(true);
    expect(eventsNamed(h.events, 'synthesisUpdated')).toHaveLength(1);
  });

  it('promoteToHub is a no-op when the note is already the hub', async () => {
    const seed = makeNote({ hub: true });
    const h = makeHarness(seed);

    const hub = await h.service.promoteToHub(seed.id);
    expect(hub.hub).toBe(true);
    expect(hub.id).toBe(seed.id);
    expect(eventsNamed(h.events, 'synthesisUpdated')).toHaveLength(0);
  });
});



