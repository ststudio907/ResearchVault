// src/ui/modals/quote-capture-modal.ts
//
// Modal for capturing quotes from a paper. Opens when the user clicks "Add quote"
// in the paper sidebar view or from the ribbon. Captures text, page number, and
// optional tags; persists via PaperService.addQuote.

import { App, Modal, Notice, Setting } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { Quote } from '../../types';

export class QuoteCaptureModal extends Modal {
  private paperId = '';
  private text = '';
  private page = '';
  private tags: string[] = [];
  private note = '';
  private plugin!: ResearchVaultPlugin;

  constructor(app: App, plugin: ResearchVaultPlugin, paperId: string) {
    super(app);
    this.paperId = paperId;
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Capture quote' });

    new Setting(contentEl)
      .setName('Quote text')
      .addTextArea((text) => {
        text.setPlaceholder('Paste or type the quoted passage...');
        text.setValue(this.text);
        text.onChange((v) => {
          this.text = v;
        });
      })
      .setClass('quote-capture-textarea');

    new Setting(contentEl)
      .setName('Page number')
      .addText((text) => {
        text.setPlaceholder('e.g., 42');
        text.setValue(this.page);
        text.onChange((v) => {
          this.page = v;
        });
      });

    new Setting(contentEl)
      .setName('Tags')
      .addTextArea((text) => {
        text.setPlaceholder('Comma-separated tags, e.g., methodology, key-result');
        text.setValue(this.tags.join(', '));
        text.onChange((v) => {
          this.tags = v.split(',').map((t) => t.trim()).filter(Boolean);
        });
      });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText('Save quote')
          .setCta()
          .onClick(async () => {
            await this.submit();
          }),
      );
  }

  private async submit(): Promise<void> {
    try {
      const quote: Omit<Quote, 'id'> = {
        text: this.text.trim(),
        page: this.page ? Number(this.page) : undefined,
        tags: this.tags,
        note: this.note || undefined,
        createdAt: Date.now(),
      };

      if (!quote.text) {
        throw new Error('Quote text is required.');
      }

      const result = await this.plugin.paperService.addQuote(this.paperId, quote);
      new Notice(`ResearchVault: quote added (${result.id}).`);
      this.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: ${msg}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
