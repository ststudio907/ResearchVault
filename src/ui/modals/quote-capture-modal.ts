// src/ui/modals/quote-capture-modal.ts
//
// Modal for capturing quotes from a paper. Opens when the user clicks "Add quote"
// in the sidebar view or invokes the `capture-quote` command (which pre-fills
// text from an editor selection). Captures text, locator / page, section,
// optional note, and tags; persists via PaperService.addQuote.
//
import { App, Modal, Notice, Setting } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { Paper, QuoteInput, QuoteSource } from '../../types';
import { applyStandardModalWidth } from './modal-width';

export interface QuoteCaptureOptions {
  /** Pre-fill the quote text field (e.g., from an editor selection). */
  selectedText?: string;
  /** Default paper id — defaults to most recent import in the active project. */
  defaultPaperId?: string;
  /**
   * Provenance to stamp on the saved quote. Defaults to `'editor'` when the
   * modal is opened from an editor context. Other capture surfaces (PDF
   * extraction in 2.6, a future "Notes → quote" ribbon) can pass their
   * own value.
   */
  source?: QuoteSource;
}

export class QuoteCaptureModal extends Modal {
  private papers: Paper[] = [];
  private selectedPaperId = '';
  private text = '';
  private locator = '';
  private page = '';
  private section = '';
  private note = '';
  private tags: string[] = [];
  private readonly source: QuoteSource;
  private plugin!: ResearchVaultPlugin;

  constructor(
    app: App,
    plugin: ResearchVaultPlugin,
    options: QuoteCaptureOptions = {},
  ) {
    super(app);
    this.plugin = plugin;
    this.source = options.source ?? (options.selectedText ? 'editor' : 'manual');
    if (options.selectedText) this.text = options.selectedText;
    // Resolve default paper id from the active project's most recent import.
    const activeProject = plugin.projectManager.getActiveProject();
    if (activeProject && !options.defaultPaperId) {
      const inProject = plugin.paperService.getInProject(activeProject.id);
      if (inProject.length > 0) {
        // Sort by dateAdded descending; pick the most recent.
        const sorted = [...inProject].sort((a, b) => b.dateAdded - a.dateAdded);
        this.selectedPaperId = sorted[0]!.id;
      }
    } else if (options.defaultPaperId) {
      this.selectedPaperId = options.defaultPaperId;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Capture quote' });
    contentEl.createEl('p', {
      text: `Source: ${this.source}. The quote will be appended to the chosen paper's "## Quotes" section.`,
      cls: 'setting-item-description',
    });

    // Paper picker.
    new Setting(contentEl)
      .setName('Attach to paper')
      .addDropdown((dropdown) => {
        const activeProject = this.plugin.projectManager.getActiveProject();
        if (!activeProject) {
          dropdown.addOption('', 'No active project');
          return;
        }
        this.papers = this.plugin.paperService.getInProject(activeProject.id);
        if (this.papers.length === 0) {
          dropdown.addOption('', 'No papers yet');
          return;
        }
        // Sort by dateAdded descending so the most recent is first.
        this.papers.sort((a, b) => b.dateAdded - a.dateAdded);
        for (const paper of this.papers) {
          dropdown.addOption(paper.id, `${paper.title} (${paper.citekey})`);
        }
        if (this.selectedPaperId) {
          dropdown.setValue(this.selectedPaperId);
        } else {
          dropdown.setValue(this.papers[0]!.id);
        }
        dropdown.onChange((v) => {
          this.selectedPaperId = v;
        });
      });

    // Quote text.
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

    // Free-form locator (e.g. "42", "42-43", "chap. 3 § 2"). Prefer over `page`
    // because it can capture ranges, but we still keep `page` for back-compat.
    new Setting(contentEl)
      .setName('Locator')
      .setDesc('Page number or range, e.g. "42" or "42-43".')
      .addText((text) => {
        text.setPlaceholder('42');
        text.setValue(this.locator);
        text.onChange((v) => {
          this.locator = v;
        });
      });

    // Numeric page number — preserved so existing exports that key on `page`
    // keep working. Optional; the locator field is the modern path.
    new Setting(contentEl)
      .setName('Page number (legacy)')
      .setDesc('Optional. Prefer the locator field above.')
      .addText((text) => {
        text.setPlaceholder('E.g., 42');
        text.setValue(this.page);
        text.onChange((v) => {
          this.page = v;
        });
      });

    // Section.
    new Setting(contentEl)
      .setName('Section')
      .addText((text) => {
        text.setPlaceholder('E.g., introduction, results');
        text.setValue(this.section);
        text.onChange((v) => {
          this.section = v;
        });
      });

    // Optional user note — small commentary field separate from the quote
    // itself. Renders below the blockquote in the paper note.
    new Setting(contentEl)
      .setName('Note (optional)')
      .setDesc('Your own commentary on the quote. Not included in citations.')
      .addTextArea((text) => {
        text.setPlaceholder('Why does this matter to your project?');
        text.setValue(this.note);
        text.onChange((v) => {
          this.note = v;
        });
      });

    // Tags.
    new Setting(contentEl)
      .setName('Tags')
      .addTextArea((text) => {
        text.setPlaceholder('Comma-separated tags, e.g., methodology, key-result');
        text.setValue(this.tags.join(', '));
        text.onChange((v) => {
          this.tags = v.split(',').map((t) => t.trim()).filter(Boolean);
        });
      });

    // Buttons.
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
      if (!this.selectedPaperId) {
        throw new Error('Select a paper to attach the quote to.');
      }
      const trimmedText = this.text.trim();
      if (!trimmedText) {
        throw new Error('Quote text is required.');
      }

      const trimmedLocator = this.locator.trim();
      const pageNumber = this.page ? Number(this.page) : undefined;
      const input: QuoteInput = {
        text: trimmedText,
        locator: trimmedLocator || undefined,
        page: Number.isFinite(pageNumber) ? pageNumber : undefined,
        section: this.section.trim() || undefined,
        note: this.note.trim() || undefined,
        tags: this.tags,
        createdAt: Date.now(),
        source: this.source,
      };

      await this.plugin.paperService.addQuote(this.selectedPaperId, input);
      new Notice(`Researchvault: quote added (${this.source}).`);
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
