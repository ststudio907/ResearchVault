// tests/project-manager.test.ts
//
// C3.3 follow-up chunk 2 — the typed EventBus gains `citationStyleChanged`,
// emitted by `ProjectManager.updateProject` when a project's citation style
// actually changes. These tests pin the emit contract the paper-import live
// citekey preview subscribes to (the modal re-renders the preview on emit).

import { describe, expect, it, vi } from 'vitest';
import { ProjectManager } from '../src/services/project-manager';
import type { EventBus, ResearchVaultPlugin } from '../src/core/plugin';
import type { Project } from '../src/types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'Proj',
    folderPath: 'proj',
    createdAt: 0,
    updatedAt: 0,
    settings: {
      paperTemplate: 'note',
      noteTemplate: 'note',
      citationStyle: 'apa',
      autoExtractMetadata: false,
      excludedFolders: [],
      customFields: [],
    },
    isActive: true,
    ...overrides,
  };
}

function makeHarness() {
  const events: Array<{ event: string; payload: unknown }> = [];
  const eventBus = {
    on: () => () => {},
    emit: (event: string, payload: unknown): void => {
      events.push({ event, payload });
    },
    clear: (): void => {},
  } as unknown as EventBus;

  const plugin = {
    settings: { projects: [makeProject()] },
    saveSettings: vi.fn(async (): Promise<void> => {}),
    eventBus,
  } as unknown as ResearchVaultPlugin;

  const manager = new ProjectManager(plugin);
  return { manager, events, plugin };
}

describe('ProjectManager citation-style reactivity (C3.3 follow-up)', () => {
  it('emits citationStyleChanged when a project citation style changes', async () => {
    const { manager, events } = makeHarness();
    await manager.updateProject('p-1', { settings: { citationStyle: 'ieee' } });
    expect(events).toContainEqual({ event: 'citationStyleChanged', payload: { projectId: 'p-1' } });
  });

  it('does not emit citationStyleChanged when the style is unchanged', async () => {
    const { manager, events } = makeHarness();
    await manager.updateProject('p-1', { settings: { citationStyle: 'apa' } });
    expect(events.some((e) => e.event === 'citationStyleChanged')).toBe(false);
  });

  it('still emits projectChanged on a style update', async () => {
    const { manager, events } = makeHarness();
    await manager.updateProject('p-1', { settings: { citationStyle: 'ieee' } });
    expect(events.some((e) => e.event === 'projectChanged')).toBe(true);
  });
});