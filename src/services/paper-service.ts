// src/services/paper-service.ts
//
// Sprint 2 placeholder (see plans/plan.md §7 — Sprint 2: Papers & Reading).
// Every method throws a descriptive error so premature wiring surfaces
// during Sprint 1 smoke tests rather than silently no-op'ing.
//

import type { TFile } from 'obsidian';
import type { Paper, Quote, ReadingStatus } from '../types';
import type { ResearchVaultPlugin } from '../core/plugin';
import type { ProjectManager } from './project-manager';
import type { VaultIndexer } from './vault-indexer';

/**
 * Manages person-papers: import, status transitions, quote/claim CRUD,
 * relationship tracking. Wired in programmatically by `ResearchVaultPlugin`
 * in Sprint 2 once the import modal, citekey generator, and PdfService land.
 */
export class PaperService {
  constructor(
    private readonly plugin: ResearchVaultPlugin,
    private readonly projectManager: ProjectManager,
    private readonly indexer: VaultIndexer,
  ) {}

  // ----- Creation -----
  async createFromDoi(_doi: string, _projectId: string): Promise<Paper> {
    throw this.notImplemented('createFromDoi');
  }
  async createFromPdf(_pdfPath: string, _projectId: string): Promise<Paper> {
    throw this.notImplemented('createFromPdf');
  }
  async createManual(_data: Partial<Paper>, _projectId: string): Promise<Paper> {
    throw this.notImplemented('createManual');
  }

  // ----- Updates -----
  async updatePaper(_id: string, _updates: Partial<Paper>): Promise<Paper> {
    throw this.notImplemented('updatePaper');
  }
  async updateStatus(_id: string, _status: ReadingStatus): Promise<void> {
    throw this.notImplemented('updateStatus');
  }
  async updateReadingProgress(_id: string, _progress: number): Promise<void> {
    throw this.notImplemented('updateReadingProgress');
  }

  // ----- Relationships -----
  async addCitation(_from: string, _to: string): Promise<void> {
    throw this.notImplemented('addCitation');
  }
  async addRelated(_paperId: string, _relatedId: string): Promise<void> {
    throw this.notImplemented('addRelated');
  }
  async findCitationsInPdf(_paperId: string): Promise<string[]> {
    throw this.notImplemented('findCitationsInPdf');
  }

  // ----- Quotes -----
  async addQuote(_paperId: string, _quote: Omit<Quote, 'id'>): Promise<Quote> {
    throw this.notImplemented('addQuote');
  }
  async extractQuotesFromPdf(_paperId: string): Promise<Quote[]> {
    throw this.notImplemented('extractQuotesFromPdf');
  }

  // ----- File operations -----
  async createNoteFile(_paper: Paper): Promise<TFile> {
    throw this.notImplemented('createNoteFile');
  }
  async getNoteContent(_paper: Paper): Promise<string> {
    throw this.notImplemented('getNoteContent');
  }

  // ----- Bulk -----
  async importBibtex(_bibtex: string, _projectId: string): Promise<Paper[]> {
    throw this.notImplemented('importBibtex');
  }
  async exportBibtex(_paperIds: string[]): Promise<string> {
    throw this.notImplemented('exportBibtex');
  }

  private notImplemented(method: string): Error {
    return new Error(`PaperService.${method} is not implemented yet (Sprint 2 — see plans/plan.md §7).`);
  }
}
