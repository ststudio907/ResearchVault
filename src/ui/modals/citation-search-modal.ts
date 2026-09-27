// src/ui/modals/citation-search-modal.ts
//
// Small modal for searching citations by title or query. Displays up to 5
// results; clicking a row fills the parent form and closes itself.
//
// This is the "🔍 Search by title…" / "🔍 Query journals…" affordance that
// 4.1.C wires into `PaperImportModal`. The modal is intentionally minimal —
// no pagination, no filters, just a search box + result list.

import { App, Modal } from 'obsidian';
import { asText } from '../../services/citation/csl-to-paper';
import type { CitationService } from '../../services/citation/citation-service';
import type { CslJsonRecord } from '../../services/citation/types';

export interface CitationSearchResult {
  record: CslJsonRecord;
  provider: string;
}

export class CitationSearchModal extends Modal {
  private readonly citationService: CitationService;
  private readonly onPick: (result: CitationSearchResult) => void;
  private resultsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  private initialQuery?: string;

  constructor(app: App, citationService: CitationService, queryOrOnPick: string | ((result: CitationSearchResult) => void), onPick?: (result: CitationSearchResult) => void) {
    super(app);
    this.citationService = citationService;
    
    // Support both signatures:
    //   new CitationSearchModal(app, service, query, onPick)
    //   new CitationSearchModal(app, service, onPick)  (legacy)
    if (typeof queryOrOnPick === 'string') {
      this.initialQuery = queryOrOnPick;
      this.onPick = onPick!;
    } else {
      this.onPick = queryOrOnPick;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('researchvault-citation-search-modal');

    // Header
    contentEl.createEl('h2', { text: 'Search citations' });

    // Search input row
    const searchRow = contentEl.createDiv({ cls: 'researchvault-citation-search-row' });
    const input = searchRow.createEl('input', {
      type: 'text',
      placeholder: 'Enter title or journal name…',
      cls: 'researchvault-citation-search-input',
    });
    
    // Pre-fill with initial query if provided (e.g., from Title field).
    if (this.initialQuery) {
      input.value = this.initialQuery;
    }

    // Status line (shows "Searching…" / error messages)
    this.statusEl = contentEl.createDiv({ cls: 'researchvault-citation-search-status' });

    // Results list
    this.resultsEl = contentEl.createDiv({ cls: 'researchvault-citation-search-results' });

    // Wire up search on Enter key
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const query = input.value.trim();
        if (query) {
          void this.performSearch(query);
        }
      }
    });

    // Also add a search button for non-Enter users
    const btnRow = contentEl.createDiv({ cls: 'researchvault-citation-search-btn-row' });
    const searchBtn = btnRow.createEl('button', { text: 'Search', cls: 'mod-cta' });
    searchBtn.addEventListener('click', () => {
      const query = input.value.trim();
      if (query) {
        void this.performSearch(query);
      }
    });

    // Focus the input on open
    window.setTimeout(() => input.focus(), 0);
  }

  private async performSearch(query: string): Promise<void> {
    if (!this.resultsEl || !this.statusEl) return;

    // Clear previous results and show loading state
    this.resultsEl.empty();
    this.statusEl.setText('Searching…');

    try {
      const results = await this.citationService.searchByTitle(query, 5);
      this.statusEl.setText(`Found ${results.length} result${results.length === 1 ? '' : 's'}`);

      if (results.length === 0) {
        this.resultsEl.createEl('p', {
          text: 'No results found. Try a different query.',
          cls: 'researchvault-citation-search-empty',
        });
        return;
      }

      // Render results as clickable rows
      for (const record of results) {
        const row = this.resultsEl.createDiv({ cls: 'researchvault-citation-search-result-row' });
        const titleText = asText(record.title) ?? '(Untitled)';
        row.createEl('div', { text: titleText, cls: 'researchvault-citation-search-title' });
        
        // Show authors if available
        if (record.author && record.author.length > 0) {
          const authorText = record.author.map(a => a.family).join(', ');
          row.createEl('div', { text: authorText, cls: 'researchvault-citation-search-authors' });
        }

        // Show year if available — CSL date uses `date-parts` as [[year, month?, day?]]
        const issued = record['issued'];
        if (issued && Array.isArray(issued['date-parts']) && issued['date-parts'].length > 0) {
          const parts = issued['date-parts'][0];
          if (parts && parts.length > 0 && typeof parts[0] === 'number') {
            row.createEl('div', { text: String(parts[0]), cls: 'researchvault-citation-search-year' });
          }
        }

        // Click to pick this result. The provider label is the configured
        // preferred provider that searchByTitle() just routed through, so
        // every row is consistently labelled.
        const provider = this.citationService.preferredProvider();
        row.addEventListener('click', () => {
          this.onPick({ record, provider });
          this.close();
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.statusEl.setText(`Search failed: ${msg}`);
      this.resultsEl.createEl('p', { text: 'Please try again.', cls: 'researchvault-citation-search-error' });
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
