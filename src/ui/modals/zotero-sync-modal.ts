// src/ui/modals/zotero-sync-modal.ts
//
// 5.1 — "Sync from Zotero" picker. Fetches the configured Zotero library
// as CSL-JSON, lists results in the same Title | Authors | Year grid as
// the citation-search modal, and hands the picked record to the parent
// import form.
//
// Requires Zotero sync enabled in settings (opt-in per D30); the caller
// checks `settings.zotero.enableZoteroSync` before opening.

import { App, Modal } from 'obsidian';
import { ZoteroApiError, type ZoteroClient } from '../../services/integrations/zotero/zotero-client';
import { asText } from '../../services/citation/csl-to-paper';
import type { CslJsonRecord } from '../../services/citation/types';
import { applyStandardModalWidth } from './modal-width';

export class ZoteroSyncModal extends Modal {
  private readonly zotero: ZoteroClient;
  private readonly onPick: (record: CslJsonRecord) => void;
  private resultsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(app: App, zotero: ZoteroClient, onPick: (record: CslJsonRecord) => void) {
    super(app);
    this.zotero = zotero;
    this.onPick = onPick;
  }

  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.addClass('researchvault-zotero-sync-modal');

    contentEl.createEl('h2', { text: 'Sync from Zotero' });

    this.statusEl = contentEl.createDiv({ cls: 'researchvault-citation-search-status' });
    this.resultsEl = contentEl.createDiv({ cls: 'researchvault-citation-search-results' });

    void this.refresh();
  }

  /** Fetch + render. Re-run by the Refresh button. */
  private async refresh(): Promise<void> {
    if (!this.resultsEl || !this.statusEl) return;
    this.resultsEl.empty();
    this.statusEl.setText('Fetching from Zotero…');

    try {
      const records = await this.zotero.fetchItems(25);
      if (records.length === 0) {
        this.statusEl.setText('No items found — the library (or tag filter) is empty.');
        return;
      }
      this.statusEl.setText(`Fetched ${records.length} item${records.length === 1 ? '' : 's'} — click one to fill the form.`);

      // Same 3-column grid as the citation-search modal.
      const header = this.resultsEl.createDiv({ cls: 'researchvault-citation-search-result-row researchvault-citation-search-header' });
      header.createEl('div', { text: 'Title', cls: 'researchvault-citation-search-title' });
      header.createEl('div', { text: 'Authors', cls: 'researchvault-citation-search-authors' });
      header.createEl('div', { text: 'Year', cls: 'researchvault-citation-search-year' });

      for (const record of records) {
        const row = this.resultsEl.createDiv({ cls: 'researchvault-citation-search-result-row' });
        row.createEl('div', { text: asText(record.title) ?? '(Untitled)', cls: 'researchvault-citation-search-title' });
        const authorText = record.author && record.author.length > 0
          ? record.author.map((a) => a.family).join(', ')
          : '—';
        row.createEl('div', { text: authorText, cls: 'researchvault-citation-search-authors' });
        const parts = record['issued']?.['date-parts']?.[0];
        row.createEl('div', {
          text: parts && typeof parts[0] === 'number' ? String(parts[0]) : '—',
          cls: 'researchvault-citation-search-year',
        });
        row.addEventListener('click', () => {
          this.onPick(record);
          this.close();
        });
      }
    } catch (err) {
      if (err instanceof ZoteroApiError) {
        this.statusEl.setText(`Zotero sync failed (${err.kind}) — ${err.message}`);
      } else {
        this.statusEl.setText(`Zotero sync failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
