// src/settings.ts
//
// Top-level plugin settings. Persisted via Obsidian's `Plugin#saveData`.
// Schema is versioned (`settings.version`) so future migrations can run from
// `migrateSettings(loaded)` rather than mutating in place later.
//

import type { AIConfig, Project, CitationStyle } from './types';
import { DEFAULT_CITATION_STYLE } from './types';

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
}

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
    projects: Array.isArray(candidate.projects) ? candidate.projects : [],
    version: CURRENT_SETTINGS_VERSION,
  };
}
