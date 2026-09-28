// src/types/project.ts

import type { ReadingStatus } from './literature';

export interface Project {
  id: string;                    // UUID
  name: string;                  // Display name
  folderPath: string;            // Root folder in vault (e.g., "Projects/ML Research")
  description?: string;
  createdAt: number;             // Unix timestamp
  updatedAt: number;
  settings: ProjectSettings;
  isActive: boolean;             // Only one active at a time
  /**
   * 2.9 — persisted sidebar chip-filter state (JSON string produced by
   * `serializeFilter`). Absent = default (no filters). Lives on the
   * project record so it survives reloads and switches per project.
   */
  sidebarFilter?: string;
}

export interface ProjectSettings {
  paperTemplate: string;         // Template ID for new papers
  noteTemplate: string;          // Template ID for general notes
  citationStyle: CitationStyle;   // apa, mla, chicago, ieee
  autoExtractMetadata: boolean;
  aiProvider?: string;           // openai, anthropic, local
  aiModel?: string;
  excludedFolders: string[];     // Paths to exclude from indexing
  customFields: CustomField[];   // User-defined frontmatter fields
}

export interface CustomField {
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect';
  options?: string[];            // For select/multiselect
  required: boolean;
  defaultValue?: string | number | string[] | undefined;
}

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'ieee' | 'harvard' | 'custom';

/**
 * Const-asserted array of every supported citation style.
 * Used by UI dropdowns in settings tab and create-project modal.
 */
export const CITATION_STYLES: readonly CitationStyle[] = [
  'apa',
  'mla',
  'chicago',
  'ieee',
  'harvard',
  'custom',
] as const;

/** Default citation style when a user does not pick one explicitly. */
export const DEFAULT_CITATION_STYLE: CitationStyle = 'apa';

/**
 * Input shape consumed by `ProjectManager.createProject()`.
 * Distinct from `Project` so callers cannot supply `id`, `createdAt`,
 * persistence-managed timestamps, or the `isActive` flag.
 */
export interface ProjectCreateConfig {
  name: string;
  folderPath: string;
  description?: string;
  citationStyle?: CitationStyle;
  paperTemplate?: string;
}

export interface ProjectStats {
  totalPapers: number;
  papersByStatus: Record<ReadingStatus, number>;
  totalNotes: number;
  lastActivity: number;
  aiTokensUsed: number;
}
