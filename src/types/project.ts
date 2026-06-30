// src/types/project.ts

export interface Project {
  id: string;                    // UUID
  name: string;                  // Display name
  folderPath: string;            // Root folder in vault (e.g., "Projects/ML Research")
  description?: string;
  createdAt: number;             // Unix timestamp
  updatedAt: number;
  settings: ProjectSettings;
  isActive: boolean;             // Only one active at a time
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
  defaultValue?: any;
}

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'ieee' | 'harvard' | 'custom';

export interface ProjectStats {
  totalPapers: number;
  papersByStatus: Record<ReadingStatus, number>;
  totalNotes: number;
  lastActivity: number;
  aiTokensUsed: number;
}