// tests/paper-service-addquote.test.ts
//
// Regression tests for the Slice 0 reliability fix in `PaperService.addQuote`:
// - the in-memory index is only updated AFTER the disk write succeeds
// - `quoteAdded` / `paperUpdated` fire exactly on success
// - a paper with no note on disk yet gets one materialized so the quote is
//   durable (previously it lived only in memory and vanished on reload)
// - a failed write leaves memory, disk, and the self-write marker consistent
//
// `PaperService` only touches the plugin surface through `eventBus` and
// `app.vault` on this path, so a structural fake (cast through the plugin
// type) exercises the real service code. The private `byId` index is seeded
// directly — `hydrate()` would need a full metadataCache mock to no benefit.

import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { Paper } from '../src/types';
import { PaperService } from '../src/services/paper-service';
import type { ResearchVaultPlugin } from '../src/core/plugin';
import type { ProjectManager } from '../src/services/project-manager';
import { joinFrontmatter } from '../src/utils/frontmatter';
import { toFrontmatter } from '../src/services/papers/paper-file-format';

const PATH = 'proj/papers/smith_2023_test.md';

interface RecordedEvent {
  event: string;
  payload: unknown;
}

function makePaper(): Paper {
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
  };
}

function fileFor(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.split('/').pop()!.replace(/\.md$/, '');
  return file;
}

function makeHarness(initialContent?: string) {
  const files = new Map<string, string>();
  if (initialContent !== undefined) files.set(PATH, initialContent);

  const events: RecordedEvent[] = [];
  const eventBus = {
    on: () => () => {},
    emit: (event: string, payload: unknown): void => {
      events.push({ event, payload });
    },
    clear: () => {},
  };
  const vault = {
    getAbstractFileByPath: (path: string): TFile | null =>
      files.has(path) ? fileFor(path) : null,
    process: vi.fn(async (file: TFile, fn: (data: string) => string): Promise<string> => {
      const current = files.get(file.path);
      if (current === undefined) throw new Error('File does not exist.');
      const next = fn(current);
      files.set(file.path, next);
      return next;
    }),
    create: vi.fn(async (path: string, data: string): Promise<TFile> => {
      files.set(path, data);
      return fileFor(path);
    }),
  };
  const plugin = {
    eventBus,
    app: { vault },
    settings: { projects: [] },
  } as unknown as ResearchVaultPlugin;
  const service = new PaperService(plugin, {} as ProjectManager);
  const paper = makePaper();
  (service as unknown as { byId: Map<string, Paper> }).byId.set(paper.id, paper);

  return { service, files, events, paper, vault };
}

function eventsNamed(events: RecordedEvent[], event: string): RecordedEvent[] {
  return events.filter((e) => e.event === event);
}

describe('PaperService.addQuote — Slice 0 reliability fix', () => {
  it('appends to disk first, then commits memory and emits quoteAdded + paperUpdated', async () => {
    const paper = makePaper();
    const h = makeHarness(joinFrontmatter(toFrontmatter(paper), 'User notes.\n'));

    const quote = await h.service.addQuote(paper.id, {
      text: 'A key insight',
      tags: [],
      createdAt: 1234,
    });

    // Return value gets the generated defaults.
    expect(quote.id).toBeTruthy();
    expect(quote.text).toBe('A key insight');
    expect(quote.source).toBe('editor');
    expect(quote.createdAt).toBe(1234);

    // Disk: new section appended, user body preserved.
    const content = h.files.get(PATH) ?? '';
    expect(content).toContain('## Quotes');
    expect(content).toContain('> A key insight');
    expect(content).toContain('User notes.');

    // Memory: the indexed paper now carries the quote, the staged input is untouched.
    const indexed = h.service.getById(paper.id);
    expect(indexed?.quotes).toHaveLength(1);
    expect(indexed?.quotes[0]?.id).toBe(quote.id);
    expect(h.paper.quotes).toHaveLength(0);

    // Events: exactly one quoteAdded and one paperUpdated, both post-success.
    expect(eventsNamed(h.events, 'quoteAdded')).toHaveLength(1);
    expect(eventsNamed(h.events, 'paperUpdated')).toHaveLength(1);
    expect(eventsNamed(h.events, 'quoteAdded')[0]?.payload).toEqual({
      paper: indexed,
      quote,
    });

    // The self-write echo marker is armed exactly once for the modify event.
    expect(h.service.consumeSelfWrite(PATH)).toBe(true);
  });

  it('rolls memory back and emits nothing when the disk write fails', async () => {
    const paper = makePaper();
    const h = makeHarness(joinFrontmatter(toFrontmatter(paper), 'User notes.\n'));
    h.vault.process.mockRejectedValue(new Error('disk full'));

    await expect(
      h.service.addQuote(paper.id, { text: 'lost quote', tags: [], createdAt: 1 }),
    ).rejects.toThrow('disk full');

    // Memory never diverged from disk.
    expect(h.service.getById(paper.id)?.quotes).toHaveLength(0);
    expect(h.files.get(PATH)).not.toContain('lost quote');
    // No subscriber was told anything happened.
    expect(h.events).toHaveLength(0);
    // The failed write disarmed its echo marker.
    expect(h.service.consumeSelfWrite(PATH)).toBe(false);
  });
});

describe('PaperService.addQuote — durability and hygiene', () => {
  it('materializes a missing note so the quote is durable', async () => {
    const paper = makePaper();
    const h = makeHarness(); // No file on disk.

    const quote = await h.service.addQuote(paper.id, {
      text: 'first quote',
      tags: ['methods'],
      createdAt: 5,
    });

    expect(h.vault.create).toHaveBeenCalledWith(PATH, expect.any(String));
    const content = h.files.get(PATH) ?? '';
    expect(content).toContain('citekey: smith_2023_test');
    expect(content).toContain('## Quotes');
    expect(content).toContain('> first quote');
    expect(content).toContain('#tags: methods');

    expect(h.service.getById(paper.id)?.quotes[0]?.id).toBe(quote.id);
    expect(eventsNamed(h.events, 'quoteAdded')).toHaveLength(1);
  });

  it('reuses the existing ## Quotes heading on subsequent quotes', async () => {
    const paper = makePaper();
    const h = makeHarness(joinFrontmatter(toFrontmatter(paper), ''));

    await h.service.addQuote(paper.id, { text: 'one', tags: [], createdAt: 1 });
    await h.service.addQuote(paper.id, { text: 'two', tags: [], createdAt: 2 });

    const content = h.files.get(PATH) ?? '';
    expect(content.split('## Quotes')).toHaveLength(2); // one heading, not one per quote
    expect(content).toContain('> one');
    expect(content).toContain('> two');
    expect(h.service.getById(paper.id)?.quotes).toHaveLength(2);
  });

  it('refuses cleanly when there is no note and no papersFolder recorded', async () => {
    const paper = { ...makePaper(), customFields: { projectId: 'p-1' } };
    const h = makeHarness();
    (h.service as unknown as { byId: Map<string, Paper> }).byId.set(paper.id, paper);

    await expect(
      h.service.addQuote(paper.id, { text: 'x', tags: [], createdAt: 1 }),
    ).rejects.toThrow(/papersFolder/);

    // Memory unchanged, nothing emitted, nothing written.
    expect(h.service.getById(paper.id)?.quotes).toHaveLength(0);
    expect(h.events).toHaveLength(0);
    expect(h.vault.create).not.toHaveBeenCalled();
  });
});