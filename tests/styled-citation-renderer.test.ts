// tests/styled-citation-renderer.test.ts
//
// C3.3 — the paper-import live citekey preview renderer, exercised against
// the *real* vendored styles and locale (inflated through the production
// path) with a mocked plugin service. The preview's group/narrative rendering
// shares the bundled citeproc engine + C3.1 mapper, so these tests pin the
// contract the paper-import chip relies on: single-key parenthetical, multi-key
// group, narrative form, and the raw-fallback `null` posture.

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';
import { inflateGzipBase64 } from '../src/services/citation/csl-inflate';
import { renderStyledCitationGroups, renderStyledCitationText } from '../src/ui/styled-citation-renderer';
import type { ResearchVaultPlugin } from '../src/core/plugin';
import type { Paper, Project } from '../src/types';

let apaXml = '';
let localeXml = '';

beforeAll(async () => {
  const { CSL_BUNDLED, CSL_LOCALES } = await import('../src/services/citation/csl-bundle.generated');
  apaXml = await inflateGzipBase64(CSL_BUNDLED['apa'] ?? '');
  localeXml = await inflateGzipBase64(CSL_LOCALES['en-US'] ?? '');
  // Sanity: the production inflate path really produced CSL XML.
  expect(apaXml).toContain('<style');
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

const papersByCitekey: Record<string, Paper> = { smith_2020: smith, jones_2019: jones };
const papersInProject: Record<string, Paper> = { ...papersByCitekey };

const project: Project = {
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
};

const plugin = {
  paperService: {
    getByCitekey: (citekey: string, projectId?: string): Paper | undefined => {
      const pool = projectId ? papersInProject : papersByCitekey;
      return pool[citekey];
    },
  },
  projectManager: {
    getActiveProject: (): Project | null => null,
    getAllProjects: (): Project[] => [project],
  },
  settings: { globalCitationStyle: 'apa' },
} as unknown as ResearchVaultPlugin;

describe('renderStyledCitationGroups (C3.3 paper-import preview renderer)', () => {
  it('renders a single-key parenthetical group for the preview chip', async () => {
    const rendered = await renderStyledCitationGroups(plugin, ['smith_2020'], { projectId: 'p-1' });
    expect(rendered).toEqual(['(Smith & Jones, 2020)']);
  });

  it('renders a multi-key group as one cluster', async () => {
    const rendered = await renderStyledCitationGroups(plugin, ['smith_2020', 'jones_2019'], { projectId: 'p-1' });
    expect(rendered).toEqual(['(Jones, 2019; Smith & Jones, 2020)']);
  });

  it('renders the narrative @key form when requested', async () => {
    const rendered = await renderStyledCitationGroups(plugin, ['smith_2020'], { projectId: 'p-1', narrative: true });
    expect(rendered).toEqual(['Smith & Jones (2020)']);
  });

  it('returns null when the key does not resolve (raw fallback)', async () => {
    const rendered = await renderStyledCitationGroups(plugin, ['nope_9999'], { projectId: 'p-1' });
    expect(rendered).toBeNull();
  });
});

describe('renderStyledCitationText (C3.3 single-key preview wrapper)', () => {
  it('returns the styled text for a resolvable key', async () => {
    const text = await renderStyledCitationText(plugin, 'smith_2020', { projectId: 'p-1' });
    expect(text).toBe('(Smith & Jones, 2020)');
  });

  it('returns null for an unresolvable key', async () => {
    const text = await renderStyledCitationText(plugin, 'nope_9999', { projectId: 'p-1' });
    expect(text).toBeNull();
  });
});