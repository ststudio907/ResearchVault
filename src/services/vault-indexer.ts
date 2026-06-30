// src/services/vault-indexer.ts
//
// Sprint 3 placeholder (see plans/plan.md §7 — Sprint 3: Citations & Indexing).
// Real implementation wires `fuse.js` for fuzzy search and builds an
// in-memory citation graph for AI context selection.
//

import type { TFile } from 'obsidian';
import type { Paper, LiteratureNote, ReadingStatus, Priority } from '../types';
import type { ResearchVaultPlugin } from '../core/plugin';

/** A chunk of paper text prepared for AI context. (Sprint 3) */
export interface TextChunk {
  paperId: string;
  text: string;
  page?: number;
  tokenEstimate: number;
}

/** Node + edges for the citation graph. (Sprint 3) */
export interface CitationGraph {
  nodes: Array<{ id: string; title: string }>;
  edges: Array<{
    from: string;
    to: string;
    kind: 'cites' | 'extends' | 'contradicts' | 'related';
  }>;
}

/** Filters surfaced in search UI. Kept in this file because only the indexer consumes them. */
export interface SearchFilters {
  status?: ReadingStatus[];
  year?: { min?: number; max?: number };
  authors?: string[];
  tags?: string[];
  priority?: Priority[];
  rating?: { min?: number; max?: number };
  dateAdded?: { after?: number; before?: number };
  hasPdf?: boolean;
  hasNotes?: boolean;
  customFields?: Record<string, unknown>;
}

export class VaultIndexer {
  constructor(private readonly plugin: ResearchVaultPlugin) {}

  // ----- Indexing -----
  async buildIndex(): Promise<void> {
    throw this.notImplemented('buildIndex');
  }
  async updateIndex(_file: TFile): Promise<void> {
    throw this.notImplemented('updateIndex');
  }
  async removeFromIndex(_file: TFile): Promise<void> {
    throw this.notImplemented('removeFromIndex');
  }

  // ----- Search -----
  searchPapers(_query: string, _filters?: SearchFilters): Paper[] {
    throw this.notImplemented('searchPapers');
  }
  searchNotes(_query: string): LiteratureNote[] {
    throw this.notImplemented('searchNotes');
  }
  findUnlinkedMentions(_citekey: string): TFile[] {
    throw this.notImplemented('findUnlinkedMentions');
  }

  // ----- Graph -----
  getCitationGraph(): CitationGraph {
    throw this.notImplemented('getCitationGraph');
  }
  getRelatedPapers(_paperId: string, _depth?: number): string[] {
    throw this.notImplemented('getRelatedPapers');
  }

  // ----- AI prep -----
  getChunksForPaper(_paperId: string): TextChunk[] {
    throw this.notImplemented('getChunksForPaper');
  }
  getProjectContext(_projectId: string, _maxTokens?: number): string {
    throw this.notImplemented('getProjectContext');
  }

  private notImplemented(method: string): Error {
    return new Error(`VaultIndexer.${method} is not implemented yet (Sprint 3 — see plans/plan.md §7).`);
  }
}
