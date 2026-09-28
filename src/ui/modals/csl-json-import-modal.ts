// src/ui/modals/csl-json-import-modal.ts
//
// 4.1.1 — generic CSL-JSON paste affordance. The user pastes a CSL-JSON
// object or array (Zotero / Mendeley / EndNote "export as CSL JSON", a
// publisher's citation download, etc.) and the parent import modal fills
// its empty fields from the FIRST record. Extra records are reported but
// not applied — the import modal is a single-paper form.
//
// Local-only: no network. Parsing/validation lives in
// `CitationService.importCslJson` (kept for exactly this purpose since
// 4.1.A), so this modal is pure UI.

import { App, Modal } from 'obsidian';
import { applyStandardModalWidth } from './modal-width';

export class CslJsonImportModal extends Modal {
  private readonly onImport: (text: string) => void;

  constructor(app: App, onImport: (text: string) => void) {
    super(app);
    this.onImport = onImport;
  }

  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.addClass('researchvault-csl-import-modal');

    // eslint-disable-next-line obsidianmd/ui/sentence-case -- CSL is an acronym (cf. the "API" precedent from 4.1.C)
    contentEl.createEl('h2', { text: 'Import CSL-JSON' });
    contentEl.createEl('p', {
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- CSL is an acronym
      text: 'Paste a CSL-JSON record (or an array of records). The first record fills the empty fields of the paper form. No data leaves your device.',
      cls: 'setting-item-description',
    });

    const textarea = contentEl.createEl('textarea', {
      cls: 'researchvault-csl-import-textarea',
    });
    textarea.placeholder = '{"type": "article-journal", "title": "…", "author": [{"family": "…"}], …}';
    textarea.spellcheck = false;

    const btnRow = contentEl.createDiv({ cls: 'researchvault-csl-import-btn-row' });
    btnRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const importBtn = btnRow.createEl('button', { text: 'Import', cls: 'mod-cta' });
    importBtn.addEventListener('click', () => {
      this.onImport(textarea.value);
      this.close();
    });

    window.setTimeout(() => textarea.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
