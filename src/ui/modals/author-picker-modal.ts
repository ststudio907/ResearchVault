// src/ui/modals/author-picker-modal.ts
//
// 2.9 — author typeahead for the sidebar filter chip row. Lists the
// project's distinct authors (ranked by paper count via
// `distinctAuthors`), filters as you type, and hands the picked last name
// to the sidebar as an exact-match author filter pill.
//
// Local-only; data comes from the in-memory paper index.

import { App, Modal } from 'obsidian';
import { applyStandardModalWidth } from './modal-width';

export interface AuthorOption {
  name: string;
  count: number;
}

export class AuthorPickerModal extends Modal {
  private readonly options: AuthorOption[];
  private readonly onPick: (name: string) => void;
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  constructor(app: App, options: AuthorOption[], onPick: (name: string) => void) {
    super(app);
    this.options = options;
    this.onPick = onPick;
  }

  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.addClass('researchvault-author-picker');

    contentEl.createEl('h2', { text: 'Filter by author' });

    this.inputEl = contentEl.createEl('input', {
      type: 'text',
      placeholder: 'Type to narrow the list…',
      cls: 'researchvault-citation-search-input',
    });
    this.inputEl.addEventListener('input', () => this.renderList(this.inputEl?.value ?? ''));

    this.listEl = contentEl.createDiv({ cls: 'researchvault-author-picker-list' });
    this.renderList('');

    window.setTimeout(() => this.inputEl?.focus(), 0);
  }

  private renderList(query: string): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const q = query.trim().toLowerCase();
    const matches = q
      ? this.options.filter((o) => o.name.toLowerCase().includes(q))
      : this.options;
    if (matches.length === 0) {
      this.listEl.createEl('p', {
        text: 'No authors match.',
        cls: 'researchvault-sidebar-empty',
      });
      return;
    }
    for (const option of matches.slice(0, 15)) {
      const row = this.listEl.createDiv({ cls: 'researchvault-author-picker-row' });
      row.createEl('span', { text: option.name, cls: 'researchvault-author-picker-name' });
      row.createEl('span', {
        text: `${option.count} paper${option.count === 1 ? '' : 's'}`,
        cls: 'researchvault-author-picker-count',
      });
      row.addEventListener('click', () => {
        this.onPick(option.name);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
