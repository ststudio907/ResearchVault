// src/ui/modals/paper-import-modal.ts
//
// Manual paper import form. Collects the metadata that doesn't require a
// network call or PDF parser, shows a live citekey preview, and submits to
// `PaperService.createManual`. `createFromDoi` / `createFromPdf` remain
// `notImplemented` per the Sprint 2 lean decision (see plans/plan.md §7).
//
// Surface (per plans/plan.md §14 — 2.2):
//   • Active project dropdown (defaults to the current active project).
//   • Fields: title*, first author last name*, additional authors, year,
//     journal, DOI, abstract, tags, PDF path (free-form).
//   • Live citekey preview rendered alongside the form via
//     `composeCitekey`; collision check against the in-memory index via
//     `generateUniqueCitekey`.
//   • "Add paper" CTA disabled while required fields are blank or invalid.
//

import { App, Modal, Notice, Setting, normalizePath } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { Author, Paper, Priority, ReadingStatus } from '../../types';
import { READING_STATUSES } from '../../types';
import { generateUniqueCitekey, slugify } from '../../utils/citekey';

interface PaperImportForm {
  projectId: string;
  title: string;
  primaryAuthorLast: string;
  additionalAuthors: string;
  year: string;
  venue: string;
  doi: string;
  abstract: string;
  keywords: string;
  pdfPath: string;
  status: ReadingStatus;
  priority: Priority;
  explicitCitekey: string;
}

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical'];

export class PaperImportModal extends Modal {
  private readonly rv: ResearchVaultPlugin;
  private readonly form: PaperImportForm;
  /** Cache the DOM node for the live citekey preview so we can re-render it cheaply on each input. */
  private previewEl: HTMLElement | null = null;
  /** Cached button so we can flip its disabled state as the form becomes valid. */
  private submitBtn: HTMLButtonElement | null = null;
  /** Stable, pre-computed citekey shown next to the form. */
  private previewedCitekey = '';

  constructor(app: App, plugin: ResearchVaultPlugin) {
    super(app);
    this.rv = plugin;
    const activeId = this.rv.projectManager.getActiveProject()?.id ?? '';
    this.form = {
      projectId: activeId,
      title: '',
      primaryAuthorLast: '',
      additionalAuthors: '',
      year: String(new Date().getFullYear()),
      venue: '',
      doi: '',
      abstract: '',
      keywords: '',
      pdfPath: '',
      status: 'queued',
      priority: 'medium',
      explicitCitekey: '',
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('researchvault-paper-import');

    contentEl.createEl('h2', { text: 'Add paper' });
    contentEl.createEl('p', {
      text: 'Fill in the metadata by hand. Doi lookup and PDF text extraction land in a follow-up sprint.',
      cls: 'setting-item-description',
    });

    if (this.rv.projectManager.getAllProjects().length === 0) {
      contentEl.createEl('p', {
        text: 'You need at least one project before you can add a paper. Use “create research project” first.',
        cls: 'researchvault-paper-import-empty',
      });
      return;
    }

    this.renderProjectRow(contentEl);
    this.renderMetadataRows(contentEl);
    this.renderPreview(contentEl);
    this.renderActionRow(contentEl);

    // Make sure the preview reflects the seed values right away.
    this.refreshPreview();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Field renderers
  // -------------------------------------------------------------------------

  private renderProjectRow(root: HTMLElement): void {
    const projects = this.rv.projectManager.getAllProjects();
    new Setting(root)
      .setName('Project')
      .setDesc('The paper will be created in this project\'s `papers/` folder.')
      .addDropdown((dropdown) => {
        for (const project of projects) dropdown.addOption(project.id, project.name);
        dropdown.setValue(this.form.projectId);
        dropdown.onChange((v) => {
          this.form.projectId = v;
        });
      });
  }

  private renderMetadataRows(root: HTMLElement): void {
    new Setting(root)
      .setName('Title')
      .setDesc('Required.')
      .addText((text) => {
        text.setPlaceholder('Attention is all you need');
        text.onChange((v) => {
          this.form.title = v;
          this.refreshPreview();
        });
      });

    new Setting(root)
      .setName('Primary author last name')
      .setDesc('Required. Used to build the citekey.')
      .addText((text) => {
        text.setPlaceholder('Vaswani');
        text.onChange((v) => {
          this.form.primaryAuthorLast = v;
          this.refreshPreview();
        });
      });

    new Setting(root)
      .setName('Additional authors')
      .setDesc('Comma-separated, e.g. "shazeer, parmar, uszkoreit".')
      .addText((text) => {
        text.setPlaceholder('E.g. Smith, jones');
        text.onChange((v) => {
          this.form.additionalAuthors = v;
        });
      });

    new Setting(root)
      .setName('Year')
      .setDesc('4-digit year. Defaults to the current year.')
      .addText((text) => {
        text.setValue(this.form.year);
        text.onChange((v) => {
          this.form.year = v;
          this.refreshPreview();
        });
      });

    new Setting(root)
      .setName('Journal / venue')
      .addText((text) => {
        text.setPlaceholder('Neurips');
        text.onChange((v) => {
          this.form.venue = v;
        });
      });

    new Setting(root)
      .setName('DOI')
      .addText((text) => {
        text.setPlaceholder('10.5555/123456');
        text.onChange((v) => {
          this.form.doi = v;
        });
      });

    new Setting(root)
      .setName('Abstract')
      .addTextArea((text) => {
        text.setPlaceholder('One paragraph summary.');
        text.onChange((v) => {
          this.form.abstract = v;
        });
      });

    new Setting(root)
      .setName('Tags / keywords')
      .setDesc('Comma-separated. Lower-cased on save.')
      .addText((text) => {
        text.setPlaceholder('E.g. Transformer, attention');
        text.onChange((v) => {
          this.form.keywords = v;
        });
      });

    new Setting(root)
      .setName('Status')
      .addDropdown((dropdown) => {
        for (const status of READING_STATUSES) dropdown.addOption(status, status);
        dropdown.setValue(this.form.status);
        dropdown.onChange((v) => {
          this.form.status = v as ReadingStatus;
        });
      });

    new Setting(root)
      .setName('Priority')
      .addDropdown((dropdown) => {
        for (const p of PRIORITIES) dropdown.addOption(p, p);
        dropdown.setValue(this.form.priority);
        dropdown.onChange((v) => {
          this.form.priority = v as Priority;
        });
      });

    new Setting(root)
      .setName('PDF path (optional)')
      .setDesc('Free-form vault path. File is not parsed yet.')
      .addText((text) => {
        text.setPlaceholder('Projects/ML Research/pdfs/vaswani2017attention.pdf');
        text.onChange((v) => {
          this.form.pdfPath = v;
        });
      });

    new Setting(root)
      .setName('Citekey')
      .setDesc('Optional. Auto-derived from author/year/title if blank.')
      .addText((text) => {
        text.setPlaceholder('Leave blank for auto');
        text.onChange((v) => {
          this.form.explicitCitekey = v;
          this.refreshPreview();
        });
      });
  }

  private renderPreview(root: HTMLElement): void {
    const block = root.createDiv({ cls: 'researchvault-paper-import-preview' });
    block.createEl('span', { text: 'Citekey: ', cls: 'researchvault-paper-import-preview-label' });
    this.previewEl = block.createEl('code', {
      text: '—',
      cls: 'researchvault-paper-import-preview-value',
    });
  }

  private renderActionRow(root: HTMLElement): void {
    new Setting(root)
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close()),
      )
      .addButton((btn) => {
        btn.setButtonText('Add paper').setCta();
        this.submitBtn = btn.buttonEl;
        btn.onClick(async () => {
          await this.submit();
        });
        this.updateSubmitEnabled();
      });
  }

  // -------------------------------------------------------------------------
  // Validation + preview
  // -------------------------------------------------------------------------

  /** Update the live citekey chip in the modal footer. */
  private refreshPreview(): void {
    if (!this.previewEl) return;
    const candidate = this.computePreviewedCitekey();
    this.previewedCitekey = candidate ?? '';
    this.previewEl.setText(candidate ? `${candidate}.md` : '— (need title + author + 4-digit year)');
    this.updateSubmitEnabled();
  }

  /** Compute a non-colliding citekey. Returns `null` if inputs are insufficient. */
  private computePreviewedCitekey(): string | null {
    const baseTitle = this.form.title.trim();
    const baseAuthor = this.form.primaryAuthorLast.trim();
    const year = Number(this.form.year);
    if (!baseTitle || !baseAuthor || !Number.isFinite(year)) return null;

    if (this.form.explicitCitekey.trim()) {
      return slugify(this.form.explicitCitekey) || null;
    }

    const isTaken = (candidate: string): boolean =>
      this.rv.paperService.getByCitekey(candidate) !== undefined;
    return generateUniqueCitekey(
      { lastName: baseAuthor, year, title: baseTitle },
      isTaken,
    );
  }

  private updateSubmitEnabled(): void {
    if (!this.submitBtn) return;
    const valid = this.validate();
    this.submitBtn.disabled = !valid;
    this.submitBtn.toggleClass('mod-disabled', !valid);
  }

  /** Pure validation — no throws, returns a boolean only. */
  private validate(): boolean {
    if (!this.form.projectId) return false;
    if (!this.form.title.trim()) return false;
    if (!this.form.primaryAuthorLast.trim()) return false;
    const year = Number(this.form.year);
    if (!Number.isFinite(year)) return false;
    if (year < 1000 || year > new Date().getFullYear() + 5) return false;
    return this.computePreviewedCitekey() !== null;
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  private async submit(): Promise<void> {
    if (!this.validate()) return;
    const citekey = this.computePreviewedCitekey();
    if (!citekey) return;
    if (!this.rv.projectManager.getProjectById(this.form.projectId)) {
      new Notice('Researchvault: pick a project before adding a paper.');
      return;
    }

    const authors: Author[] = buildAuthors(this.form.primaryAuthorLast, this.form.additionalAuthors);
    const year = Number(this.form.year);

    try {
      const paper: Paper = await this.rv.paperService.createManual(
        {
          title: this.form.title.trim(),
          authors,
          year,
          venue: this.form.venue.trim() || undefined,
          doi: this.form.doi.trim() || undefined,
          abstract: this.form.abstract.trim() || undefined,
          pdfPath: this.form.pdfPath.trim() || undefined,
          keywords: this.form.keywords
            .split(',')
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean),
          status: this.form.status,
          priority: this.form.priority,
          citekey,
        },
        this.form.projectId,
      );
      new Notice(`ResearchVault: imported "${paper.citekey}".`);
      this.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: ${msg}`);
    }
  }
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert the free-form "Author, Author, Author" input into `Author` rows.
 * Names longer than one token are split heuristically: last token becomes
 * the `lastName`, the rest becomes `firstName`. This is intentionally
 * low-effort; users can edit the file directly if they want full fidelity.
 */
function buildAuthors(primary: string, additional: string): Author[] {
  const tokens = [primary, ...additional.split(',')].map((t) => t.trim()).filter(Boolean);
  return tokens.map((raw) => {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: '', lastName: parts[0] ?? '' };
    const last = parts[parts.length - 1] ?? '';
    const first = parts.slice(0, -1).join(' ');
    return { firstName: first, lastName: last };
  });
}

// `normalizePath` is imported for parity with the rest of the codebase even
// though we don't transform the form values here. Keeping the import also
// makes it clear that callers should normalise on the way out if we ever
// start ingesting arbitrary paths from the form.
void normalizePath;
