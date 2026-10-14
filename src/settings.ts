// src/settings.ts
//
// Top-level plugin settings. Persisted via Obsidian's `Plugin#saveData`.
// Schema is versioned (`settings.version`) so future migrations can run from
// `migrateSettings(loaded)` rather than mutating in place later.
//

import type { AIConfig, Project, CitationStyle, CitationSettings } from './types';
import { DEFAULT_CITATION_STYLE, DEFAULT_CITATION_SETTINGS } from './types';
import {
  DEFAULT_ZOTERO_SETTINGS,
  type ZoteroSettings,
} from './services/integrations/zotero/zotero-client';
import {
  DEFAULT_FILTER_PANEL,
  type FilterPanelState,
} from './ui/views/filter-panel';

/** Maximum value of `version` this build knows how to migrate from. Bump when shape changes. */
export const CURRENT_SETTINGS_VERSION = '1' as const;

export interface TemplateConfig {
  paper: string;
  note: string;
  dailyNote: string;
}

export interface ResearchVaultSettings {
  /** Schema version. Launcher for `migrateSettings`. */
  version: typeof CURRENT_SETTINGS_VERSION;
  projects: Project[];
  templates: TemplateConfig;
  globalCitationStyle: CitationStyle;
  globalExcludedFolders: string[];
  ai: AIConfig;
  /**
   * Citation lookup preferences (4.1.A). OFF by default per `D29` — no
   * network identifier leaves the device until the user explicitly enables
   * the feature in the Citations settings tab (4.1.D). The full shape lives
   * in `CitationSettings` (services/citation/types.ts); we re-export it via
   * the `types` barrel so consumers can `import { CitationSettings } from '../types'`.
   */
  citation: CitationSettings;
  /**
   * Zotero web API read-in (5.1, D30 layer a). OFF by default — nothing
   * hits api.zotero.org until the user enables it and enters a userID +
   * API key. Shape lives in `ZoteroSettings`
   * (services/integrations/zotero/zotero-client.ts).
   */
  zotero: ZoteroSettings;
  /**
   * Sidebar filter-panel state (2.9.C). Global across projects — the user's
   * ask was about visual noise, which is a device-level preference. Shape
   * lives in `FilterPanelState` (ui/views/filter-panel.ts).
   */
  filterPanel: FilterPanelState;
  /**
   * Vault-level folder where attached PDFs are stored (D34, 2026-10 refactor).
   * One shared library across all projects — the same paper attached in two
   * projects links the same file, never a duplicate copy. Editable in
   * Settings → Research Vault. Existing per-project `pdfs/` copies stay
   * valid (their `pdfPath` still points at them); only NEW attachments land
   * here.
   */
  pdfLibraryFolder: string;
}

// D34: the shared-PDF-library default + normalizer live in the pure
// `papers/paper-matching` module (importable from unit tests); imported for
// use below and re-exported so settings consumers have one obvious site.
import { DEFAULT_PDF_LIBRARY_FOLDER, normalizePdfLibraryFolder } from './services/papers/paper-matching';
export { DEFAULT_PDF_LIBRARY_FOLDER, normalizePdfLibraryFolder };

export const DEFAULT_TEMPLATES: TemplateConfig = {
  paper: `# {{title}}

> Authors: {{authors}} ({{year}}). {{venue}}.

## Summary
<!-- One paragraph framing of the paper -->

## Key points
- 

## Methodology

## Results

## Critique / questions
- 

## Connections
- 
`,
  note: `# {{title}}

## Idea
<!-- atomic idea statement -->

## Evidence
<!-- supporting quotes / citekey references -->

## Implications
<!-- what this means for the project -->
`,
  dailyNote: `# {{date}}

## Today's focus
- 

## Captured references
- 
`,
};

export const DEFAULT_SETTINGS: ResearchVaultSettings = {
  version: CURRENT_SETTINGS_VERSION,
  projects: [],
  templates: DEFAULT_TEMPLATES,
  globalCitationStyle: DEFAULT_CITATION_STYLE,
  globalExcludedFolders: ['.trash'],
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.7,
    enableSummarization: false,
    enableChat: false,
    enableSuggestions: false,
    currentMonthUsage: 0,
  },
  // 4.1.A: `enableCitationLookup: false` per D29 — feature is off until the
  // user explicitly opts in. `politeContact: ''` per Q2 — no identifier
  // leaves the device by default. The settings tab (4.1.D) flips both.
  citation: { ...DEFAULT_CITATION_SETTINGS },
  // 5.1: Zotero sync off by default per D30 — no api.zotero.org traffic
  // until the user opts in with a userID + API key (settings tab).
  zotero: { ...DEFAULT_ZOTERO_SETTINGS },
  // 2.9.C: filter panel defaults = show everything, Attention on, panel
  // collapsed. `status`/`priority` null = all (no filter bytes by default).
  filterPanel: { ...DEFAULT_FILTER_PANEL },
  // D34: one vault-level PDF library shared by all projects.
  pdfLibraryFolder: DEFAULT_PDF_LIBRARY_FOLDER,
};

/**
 * Forward-compatible migration entry point. Newer versions should add new
 * cases here; older clients receiving a newer payload should be handled by
 * the version check in `ResearchVaultPlugin.onload` (downgrade is unsupported).
 */
export function migrateSettings(raw: unknown): ResearchVaultSettings {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const candidate = raw as Partial<ResearchVaultSettings>;
  // For now everything is version 1. Future migrations slot in here.
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...candidate,
    ai: { ...DEFAULT_SETTINGS.ai, ...(candidate.ai ?? {}) },
    templates: { ...DEFAULT_TEMPLATES, ...(candidate.templates ?? {}) },
    // 4.1.A: default-fill the citation block (L3 — the existing migrateSettings
    // is a spread-merge, not a versioned switch). Older payloads that pre-date
    // 4.1.A simply get a fresh `DEFAULT_CITATION_SETTINGS` block stamped in.
    citation: { ...DEFAULT_CITATION_SETTINGS, ...(candidate.citation ?? {}) },
    filterPanel: {
      ...DEFAULT_FILTER_PANEL,
      ...((candidate.filterPanel ?? {}) as Partial<FilterPanelState>),
    },
    projects: Array.isArray(candidate.projects) ? candidate.projects : [],
    // D34: default-fill + normalize (guards against a persisted empty string).
    pdfLibraryFolder: normalizePdfLibraryFolder(candidate.pdfLibraryFolder),
    version: CURRENT_SETTINGS_VERSION,
  };
}
