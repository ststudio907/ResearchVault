// src/ui/modals/paper-import-modal.ts
//
// Manual paper import form. Collects the metadata that doesn't require a
// network call or PDF parser, shows a live citekey preview, and submits to
// `PaperService.createManual`. `createFromDoi` / Bibtex import remain
// `notImplemented` per the Sprint 2 lean decision (see plans/plan.md §7).
//
// Per D28 (sub-pass 2.7.1), the PDF picker is purely an attachment source:
// selecting a PDF never overrides or fabricates metadata, and the submit
// path always goes through `createManual({ ..., attachPdfFrom })`. The D27
// `createFromPdf` shim was removed — see plans/plan.md §13 dated entry
// "Sprint 2 — Sub-pass 2.7.1".
//
// Surface (per plans/plan.md §14 — 2.2):
//   • Active project dropdown (defaults to the current active project).
//   • Fields: title*, first author last name*, additional authors, year,
//     journal, DOI, abstract, tags, optional attached PDF path.
//   • Live citekey preview rendered alongside the form via
//     `composeCitekey`; collision check against the in-memory index via
//     `generateUniqueCitekey`.
//   • "Add paper" CTA disabled while required fields are blank or invalid.
//

import { App, Modal, Notice, Setting, TFile, TextComponent, TextAreaComponent } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import type { Paper, Priority, ReadingStatus } from '../../types';
import type { PaperManualInput } from '../../services/paper-service';
import { CslJsonImportModal } from './csl-json-import-modal';
import { ZoteroSyncModal } from './zotero-sync-modal';
import { READING_STATUSES } from '../../types';
import { generateUniqueCitekey, slugify } from '../../utils/citekey';
import { applyStandardModalWidth } from './modal-width';
import { cslToManualInput } from '../../services/citation/csl-to-paper';
import type { CslJsonRecord } from '../../services/citation/types';
import { CitationSearchModal } from './citation-search-modal';

export interface PaperImportOptions {
  /** When set, the modal opens in edit mode pre-populated with the paper's metadata. */
  paperToEdit?: Paper;
}

interface PaperImportForm {
  projectId: string;
  title: string;
  primaryAuthorLast: string;
  additionalAuthors: string;
  /** Optional parallel first names (2.8.E). Empty string per index. */
  firstNames: string;
  year: string;
  venue: string;
  doi: string;
  abstract: string;
  keywords: string;
  /**
   * Vault-relative path of a PDF the user picked via "Browse vault…" or
   * drag-drop. Submit *always* sends the typed metadata through
   * `createManual`; if `pdfPath` is non-empty, `createManual` copies the
   * file into `<project>/pdfs/<citekey>.pdf` and adds a `## Attached PDF`
   * wikilink section. The PDF is an attachment only — it does not supply
   * or override any metadata field. (D28.)
   */
  pdfPath: string;
  status: ReadingStatus;
  priority: Priority;
  explicitCitekey: string;
}

const PRIORITIES: readonly Priority[] = ['low', 'normal', 'high'];

export class PaperImportModal extends Modal {
  private readonly rv: ResearchVaultPlugin;
  private readonly form: PaperImportForm;
  private readonly paperToEdit: Paper | undefined;
  private readonly isEdit: boolean;
  /** Cache the DOM node for the live citekey preview so we can re-render it cheaply on each input. */
  private previewEl: HTMLElement | null = null;
  /** Cached button so we can flip its disabled state as the form becomes valid. */
  private submitBtn: HTMLButtonElement | null = null;
  /** Stable, pre-computed citekey shown next to the form. */
  private previewedCitekey = '';
  /** Cached node under the PDF setting that displays the linked destination. */
  private pdfInfoEl: HTMLElement | null = null;

  // ----- 4.1.C — autofill tracking + citation lookup affordances -----
  /** Fields the user has manually edited; autofill only touches fields NOT in this set. */
  private readonly autofilledFields = new Set<keyof PaperImportForm>();
  /** Cached reference to the DOI Lookup button so we can flip its disabled state. */
  private doiLookupBtn: HTMLButtonElement | null = null;
  /** Inline status line for citation-lookup results; contextual alongside the form. */
  private statusEl: HTMLElement | null = null;
  // ----- 4.1.3 — live input-component refs so applyAutofill can sync the DOM -----
  /**
   * Autofill writes into `this.form` state, but the visible inputs are
   * Obsidian `TextComponent`s that keep their own DOM value — without a
   * `setValue()` round-trip the fields LOOK empty after a lookup even
   * though the data is applied (user-reported in the 4.1.E smoke,
   * 2026-09-27). We keep the component refs keyed by form field.
   */
  private readonly inputRefs: Partial<Record<keyof PaperImportForm, TextComponent | TextAreaComponent>> = {};

  constructor(app: App, plugin: ResearchVaultPlugin, options: PaperImportOptions = {}) {
    super(app);
    this.rv = plugin;
    this.paperToEdit = options.paperToEdit;
    this.isEdit = !!this.paperToEdit;
    const activeId = this.rv.projectManager.getActiveProject()?.id ?? '';
    if (this.paperToEdit) {
      // Edit mode — seed the form from the supplied paper. Citekey is locked.
      const p = this.paperToEdit;
      this.form = {
        projectId: (p.customFields['projectId'] as string | undefined) ?? activeId,
        title: p.title,
        // 2.8.E — `paper.authors` becomes the canonical last-name string[];
        // parallel `authorFirstNames?` (optional) carries first names.
        primaryAuthorLast: p.authors[0] ?? '',
        additionalAuthors: p.authors.slice(1).join(', '),
        firstNames: (p.authorFirstNames ?? []).slice(1).join(', '),
        year: String(p.year),
        venue: p.venue ?? '',
        doi: p.doi ?? '',
        abstract: p.abstract ?? '',
        keywords: p.keywords.join(', '),
        pdfPath: p.pdfPath ?? '',
        // `usePdfImport` was removed in 2.7.1 — the PDF is always just an attachment.
        status: p.status,
        priority: p.priority,
        // Pre-filling `explicitCitekey` makes `computePreviewedCitekey` return the existing
        // citekey without running uniqueness checks (the citekey is, by definition, taken).
        explicitCitekey: p.citekey,
      };
    } else {
      this.form = {
        projectId: activeId,
        title: '',
        primaryAuthorLast: '',
        additionalAuthors: '',
        firstNames: '',
        year: String(new Date().getFullYear()),
        venue: '',
        doi: '',
        abstract: '',
        keywords: '',
        pdfPath: '',
        // 2026-09-30 label redesign: 'queued' was merged into 'unread', so
        // new papers now start there directly (D31 migration map).
        status: 'unread',
        priority: 'normal',
        explicitCitekey: '',
      };
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    applyStandardModalWidth(this);
    contentEl.empty();
    contentEl.addClass('researchvault-paper-import');

    contentEl.createEl('h2', { text: this.isEdit ? 'Edit paper' : 'Add paper' });
    contentEl.createEl('p', {
      text: this.isEdit
        ? 'Edit the metadata for this paper. The citekey is locked so existing links keep working.'
        // D28 framing — PDFs are attachments only and never supply metadata.
        : 'Fill in the metadata by hand. A PDF can be attached (optional) but it won\u2019t pre-fill any field — you do. DOI lookup and PDF text extraction land in a later sprint.',
      cls: 'setting-item-description',
    });

    if (this.rv.projectManager.getAllProjects().length === 0) {
      contentEl.createEl('p', {
        text: 'You need at least one project before you can add a paper. Use “create research project” first.',
        cls: 'researchvault-paper-import-empty',
      });
      return;
    }

    // Inline status line for citation-lookup results. Defaults to empty so the
    // modal doesn't take extra space when nothing has happened yet.
    this.statusEl = contentEl.createDiv({ cls: 'researchvault-import-status' });

    this.renderProjectRow(contentEl);
    this.renderMetadataRows(contentEl);
    this.renderPreview(contentEl);
    this.renderActionRow(contentEl);

    // Make sure the preview reflects the seed values right away.
    this.refreshPreview();
  }

  onClose(): void {
    this.statusEl = null;
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
        text.setValue(this.form.title);
        this.inputRefs['title'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('title');
          this.form.title = v;
          this.refreshPreview();
        });
      })
      .addButton((btn) => {
        btn.setButtonText('🔍 Search…').setCta();
        btn.buttonEl.addClass('researchvault-citation-search-btn');
        btn.onClick(() => {
          void this.openSearchByTitle();
        });
      })
      .addButton((btn) => {
        // 4.1.1 — generic CSL-JSON paste affordance. Local-only (no
        // network, no settings gate): parses via importCslJson and fills
        // the same empty-fields-only path as DOI lookup.
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- CSL is an acronym
        btn.setButtonText('📋 Paste CSL…');
        btn.buttonEl.addClass('researchvault-csl-import-btn');
        btn.onClick(() => {
          new CslJsonImportModal(this.app, (text) => {
            this.handleCslJsonPaste(text);
          }).open();
        });
      });

    // 5.1 — "Zotero…" button, only when web-API sync is enabled and a
    // userID is configured (D30 opt-in). Picked records go through the
    // same applyManualInput path as everything else.
    const zotero = this.rv.ensureZoteroClient();
    if (zotero) {
      new Setting(root)
        .setName('Zotero')
        .setDesc('Pick an item from your Zotero library to fill the empty fields.')
        .addButton((btn) => {
          btn.setButtonText('🔁 Zotero…');
          btn.onClick(() => {
            new ZoteroSyncModal(this.app, zotero, (record) => {
              const service = this.rv.ensureCitationService();
              if (service) {
                this.applyManualInput(cslToManualInput(record, { source: 'doi' }));
                this.setStatus('Filled from Zotero.', 'info');
              }
            }).open();
          });
        });
    }

    new Setting(root)
      .setName('Primary author last name')
      .setDesc('Required. Used to build the citekey.')
      .addText((text) => {
        text.setPlaceholder('Vaswani');
        text.setValue(this.form.primaryAuthorLast);
        this.inputRefs['primaryAuthorLast'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('primaryAuthorLast');
          this.form.primaryAuthorLast = v;
          this.refreshPreview();
        });
      });

    new Setting(root)
      .setName('Additional authors')
      .setDesc('Comma-separated, e.g. "shazeer, parmar, uszkoreit".')
      .addText((text) => {
        text.setPlaceholder('E.g. Smith, jones');
        text.setValue(this.form.additionalAuthors);
        this.inputRefs['additionalAuthors'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('additionalAuthors');
          this.form.additionalAuthors = v;
        });
      });

    new Setting(root)
      .setName('Year')
      .setDesc('4-digit year. Defaults to the current year.')
      .addText((text) => {
        text.setValue(this.form.year);
        this.inputRefs['year'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('year');
          this.form.year = v;
          this.refreshPreview();
        });
      });

    new Setting(root)
      .setName('Journal / venue')
      .addText((text) => {
        text.setPlaceholder('Neurips');
        text.setValue(this.form.venue);
        this.inputRefs['venue'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('venue');
          this.form.venue = v;
        });
      });

    new Setting(root)
      .setName('DOI')
      .addText((text) => {
        text.setPlaceholder('10.5555/123456');
        text.setValue(this.form.doi);
        this.inputRefs['doi'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('doi');
          this.form.doi = v;
          this.updateLookupButton();
        });
      })
      .addButton((btn) => {
        btn.setButtonText('🔍 Lookup').setCta();
        btn.buttonEl.addClass('researchvault-citation-lookup-btn');
        this.doiLookupBtn = btn.buttonEl;
        btn.onClick(() => {
          void this.performDoiLookup();
        });
      });

    new Setting(root)
      .setName('Abstract')
      .addTextArea((text) => {
        text.setPlaceholder('One paragraph summary.');
        text.setValue(this.form.abstract);
        this.inputRefs['abstract'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('abstract');
          this.form.abstract = v;
        });
      });

    new Setting(root)
      .setName('Tags / keywords')
      .setDesc('Comma-separated. Lower-cased on save.')
      .addText((text) => {
        text.setPlaceholder('E.g. Transformer, attention');
        text.setValue(this.form.keywords);
        this.inputRefs['keywords'] = text;
        text.onChange((v) => {
          this.autofilledFields.add('keywords');
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

        // The "Attached PDF" row is followed by three full-width children that
    // *look* like they belong to the row but are NOT inside it. Why: Obsidian's
    // `.setting-item` is `display: flex` `flex-direction: row`, and the
    // right-hand control column (where Setting.setDesc(...) / control widgets
    // live) is intentionally narrow (~half the modal width). In 2.8 the drop
    // zone was appended to `pdfSetting.controlEl` and got squished into that
    // narrow column. The 2.8.1 fix keeps the Setting row thin (name + button
    // only) and mounts the help text + drop zone + path-info as full-width
    // siblings on the modal root, where they stack as block children.
    new Setting(root)
      .setName('Attached PDF')
      .addButton((btn) => {
        btn.setButtonText(this.form.pdfPath ? 'Replace PDF' : 'Attach PDF…');
        btn.buttonEl.addClass('researchvault-pdf-browse-btn');
        btn.onClick(() => {
          void this.pickPdfFromVault().then((picked) => {
            if (picked) {
              this.form.pdfPath = picked.path;
              this.refreshPdfInfo();
              this.updateSubmitEnabled();
            }
          });
        });
      });

    // (1) Capped full-width help block. `display: block` keeps it from being
    //     caught by any inherited inline layout; `max-width: 480px` stops the
    //     line from getting awkwardly long on wide windows.
    const helpEl = root.createDiv({ cls: 'researchvault-pdf-help' });
    helpEl.setText(
      this.isEdit
        ? 'Re-link or replace the attached PDF. The file is copied into the project’s pdfs/ folder.'
        : 'Optional. Attach a PDF from the vault — it will be copied into the project’s pdfs/ folder and wikilinked from the note. It does not affect any metadata field.',
    );

    // (2) Drag-and-drop zone for PDFs already in the vault. Full-width
    //     sibling of the Setting row rather than crammed into its
    //     right-hand control column.
    const dropZone = root.createDiv({ cls: 'researchvault-pdf-drop-zone' });
    dropZone.setText('Drag and drop PDF here');
    dropZone.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes('Files')) {
        dropZone.addClass('researchvault-pdf-drop-zone--active');
      }
    });
    dropZone.addEventListener('dragleave', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.removeClass('researchvault-pdf-drop-zone--active');
    });
    dropZone.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.removeClass('researchvault-pdf-drop-zone--active');
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          // Dragged files land in the OS temp dir, not the vault. Copy into the project's pdfs/ folder first.
          void this.copyPdfIntoVault(file).then((targetPath) => {
            if (targetPath) {
              this.form.pdfPath = targetPath;
              this.refreshPdfInfo();
              this.updateSubmitEnabled();
            }
          });
          break;
        }
      }
    });

    // (3) Info line shows the linked destination — both for new picks and
    //     for existing PDFs on edit. Cached on the modal so the path can
    //     be re-rendered cheaply.
    this.pdfInfoEl = root.createDiv({ cls: 'researchvault-pdf-path-info' });
    this.refreshPdfInfo();


    new Setting(root)
      .setName('Citekey')
      .setDesc(this.isEdit
        ? 'Locked: citekeys are stable so existing links keep working.'
        : 'Optional. Auto-derived from author/year/title if blank.')
      .addText((text) => {
        text.setPlaceholder('Leave blank for auto');
        text.setValue(this.form.explicitCitekey);
        if (this.isEdit) {
          text.inputEl.disabled = true;
          text.inputEl.title = 'Citekey is locked while editing.';
        }
        text.onChange((v) => {
          this.form.explicitCitekey = v;
          this.refreshPreview();
        });
      });

    // Initial state for the DOI Lookup button.
    this.updateLookupButton();
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
        btn.setButtonText(this.isEdit ? 'Save changes' : 'Add paper').setCta();
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

  /**
   * Update the PDF destination info line. Shows the linked vault path (after a
   * pick or a successful drop copy) or the planned `pdfs/` target folder for
   * the currently selected project when no PDF is chosen yet. Hidden when no
   * project is picked so we never point at a phantom folder.
   */
  private refreshPdfInfo(): void {
    if (!this.pdfInfoEl) return;
    const project = this.rv.projectManager.getProjectById(this.form.projectId);
    if (this.form.pdfPath) {
      this.pdfInfoEl.setText(`Linked PDF: ${this.form.pdfPath}`);
      this.pdfInfoEl.removeClass('mod-hidden');
      return;
    }
    if (project) {
      const target = this.rv.projectManager.getProjectPdfsFolder(project.id);
      this.pdfInfoEl.setText(`PDFs will be copied to: ${target}/`);
      this.pdfInfoEl.removeClass('mod-hidden');
      return;
    }
    this.pdfInfoEl.setText('Pick a project to see where the PDF will be saved.');
    this.pdfInfoEl.removeClass('mod-hidden');
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
  // 4.1.C — Citation lookup affordances
  // -------------------------------------------------------------------------

  /** Returns `true` when DOI lookup is enabled in settings and a service is available. */
  private isCitationLookupEnabled(): boolean {
    return this.rv.settings.citation.enableCitationLookup === true && !!this.rv.ensureCitationService();
  }

  /** Update the DOI Lookup button's disabled state based on current form state. */
  private updateLookupButton(): void {
    if (!this.doiLookupBtn) return;
    const enabled = this.isCitationLookupEnabled() && this.form.doi.trim().length > 0;
    this.doiLookupBtn.disabled = !enabled;
    this.doiLookupBtn.toggleClass('mod-disabled', !enabled);
  }

  /**
   * Write a one-line status message into the modal-internal statusEl.
   * Replaces the global Notice(...) calls for citation-lookup flows so the
   * message stays contextual (visible while the modal is open).
   */
  private setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
    if (!this.statusEl) return;
    this.statusEl.setText(message);
    this.statusEl.removeClass(
      'researchvault-import-status-info',
      'researchvault-import-status-error',
    );
    this.statusEl.addClass(
      kind === 'error' ? 'researchvault-import-status-error' : 'researchvault-import-status-info',
    );
  }

  /** Open the "Search by title" modal for the current Title field value. */
  private async openSearchByTitle(): Promise<void> {
    const query = this.form.title.trim();
    if (!query) {
      this.setStatus('Enter a title to search.', 'error');
      return;
    }

    const service = this.rv.ensureCitationService();
    if (!service) {
      this.setStatus('Citation lookup is not enabled in settings.', 'error');
      return;
    }

    // Open the search modal last so any inline status above stays put.
    const modal = new CitationSearchModal(this.app, service, query, (result) => {
      this.applyAutofill(result.record);
    });
    modal.open();
    this.setStatus(`Searching for “${query}…`, 'info');
  }

  /** Perform a DOI lookup for the current DOI field value and autofill the form. */
  private async performDoiLookup(): Promise<void> {
    const doi = this.form.doi.trim();
    if (!doi) {
      new Notice('Researchvault: enter a doi to look up.');
      return;
    }

    if (!this.isCitationLookupEnabled()) {
      new Notice('Researchvault: citation lookup is not enabled in settings.');
      return;
    }

    const service = this.rv.ensureCitationService();
    if (!service) {
      this.setStatus('Citation lookup service unavailable.', 'error');
      return;
    }

    // Inline status line as a transient spinner.
    this.setStatus(`Looking up doi “${doi}…`, 'info');
    const btn = this.doiLookupBtn;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳';
    }

    try {
      const record = await service.lookupByDoi(doi);
      if (!record) {
        this.setStatus(`No record found for doi “${doi}”.`, 'error');
        return;
      }
      this.applyAutofill(record);
      this.setStatus(
        `Filled ${this.form.title ? `“${this.form.title}” ` : ''}from ${service.preferredProvider()}. Edit any field to override; re-run lookup to fill what you left blank.`,
        'info',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`Lookup failed — ${msg}`, 'error');
    } finally {
      if (btn) {
        btn.textContent = '🔍 Lookup';
        this.updateLookupButton();
      }
    }
  }

  /**
   * Apply a CSL record to the form, filling only fields the user has NOT
   * manually edited. The citekey is never autofilled (it's derived from
   * author/year/title).
   */
  private applyAutofill(record: CslJsonRecord): void {
    const input = cslToManualInput(record, { source: 'doi' });
    this.applyManualInput(input);
  }

  /**
   * 4.1.1 — parse pasted CSL-JSON via `CitationService.importCslJson` and
   * apply the first record. Extra records are reported but not applied —
   * the import form is single-paper. Errors surface in the inline status
   * line, not a global Notice.
   */
  private handleCslJsonPaste(text: string): void {
    const service = this.rv.ensureCitationService();
    if (!service) {
      this.setStatus('Citation service unavailable.', 'error');
      return;
    }
    try {
      const inputs = service.importCslJson(text);
      if (inputs.length === 0) {
        this.setStatus('Nothing to import — the pasted text had no records.', 'error');
        return;
      }
      this.applyManualInput(inputs[0]!);
      const extra = inputs.length - 1;
      this.setStatus(
        `Filled from CSL-JSON${extra > 0 ? ` (first of ${inputs.length} records; ${extra} additional not applied — the form is single-paper).` : '.'}`,
        'info',
      );
    } catch (err) {
      this.setStatus(`CSL-JSON import failed — ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  /**
   * 4.1.1 — apply an already-converted `PaperManualInput` (from DOI lookup,
   * title search, or CSL-JSON paste) to the form, filling only fields the
   * user has NOT manually edited. Shared by all fill paths so the
   * track-on-edit semantics are identical everywhere.
   */
  private applyManualInput(input: PaperManualInput): void {
    // Title — only fill if the user hasn't typed anything yet.
    if (input.title && !this.autofilledFields.has('title')) {
      this.form.title = input.title;
      this.refreshPreview();
    }

    // Authors — only fill primary author last name and additional authors if untouched.
    if (input.authors.length > 0) {
      const primaryAuthor = input.authors[0];
      if (primaryAuthor && !this.autofilledFields.has('primaryAuthorLast')) {
        this.form.primaryAuthorLast = primaryAuthor;
        this.refreshPreview();
      }
      // Additional authors — only fill if the user hasn't typed anything yet.
      const additionalAuthors = input.authors.slice(1).join(', ');
      if (additionalAuthors && !this.autofilledFields.has('additionalAuthors')) {
        this.form.additionalAuthors = additionalAuthors;
      }
      // First names — only fill if untouched.
      if (input.authorFirstNames?.length && !this.autofilledFields.has('firstNames')) {
        this.form.firstNames = input.authorFirstNames.join(', ');
      }
    }

    // Year — only fill if not already set by the user.
    if (input.year && !this.autofilledFields.has('year')) {
      this.form.year = String(input.year);
      this.refreshPreview();
    }

    // Venue / journal — only fill if untouched.
    if (input.venue && !this.autofilledFields.has('venue')) {
      this.form.venue = input.venue;
    }

    // DOI — only fill if the user hasn't typed anything yet.
    if (input.doi && !this.autofilledFields.has('doi')) {
      this.form.doi = input.doi;
      this.updateLookupButton();
    }

    // Abstract — only fill if untouched.
    if (input.abstract && !this.autofilledFields.has('abstract')) {
      this.form.abstract = input.abstract;
    }

    // Keywords — only fill if the user hasn't typed anything yet.
    const keywords = input.keywords ?? [];
    if (keywords.length > 0 && !this.autofilledFields.has('keywords')) {
      this.form.keywords = keywords.join(', ');
    }

    // 4.1.3 — sync the visible inputs. applyAutofill only mutates `this.form`
    // state; without this round-trip the fields LOOK empty after a lookup
    // even though the data is applied (4.1.E smoke finding, 2026-09-27).
    // setValue() does not fire onChange, so autofilledFields tracking and
    // the form state are not disturbed.
    this.syncInputs();
  }

  /** Push current form values into the cached input components. */
  private syncInputs(): void {
    for (const [key, component] of Object.entries(this.inputRefs)) {
      component.setValue(this.form[key as keyof PaperImportForm]);
    }
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  private async submit(): Promise<void> {
    if (!this.validate()) return;
    if (!this.rv.projectManager.getProjectById(this.form.projectId)) {
      new Notice('Researchvault: pick a project before saving a paper.');
      return;
    }

    const { lastNames, firstNames } = buildAuthorRows(
      this.form.primaryAuthorLast,
      this.form.additionalAuthors,
      this.form.firstNames,
    );
    const year = Number(this.form.year);
    const keywords = this.form.keywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    try {
      if (this.isEdit && this.paperToEdit) {
        const updated: Paper = await this.rv.paperService.updatePaper(this.paperToEdit.id, {
          title: this.form.title.trim(),
          authors: lastNames,
          authorFirstNames: firstNames,
          year,
          venue: this.form.venue.trim() || undefined,
          doi: this.form.doi.trim() || undefined,
          abstract: this.form.abstract.trim() || undefined,
          pdfPath: this.form.pdfPath.trim() || undefined,
          keywords,
          status: this.form.status,
          priority: this.form.priority,
        });
        new Notice(`ResearchVault: saved "${updated.citekey}".`);
        this.close();
        return;
      }

      // D28 — submit is always typed metadata + optional PDF attachment.
      // `createManual` re-validates required fields and copies the PDF (if any)
      // into `<project>/pdfs/<citekey>.pdf` with a `-2 -3 …` collision suffix.
      // The citekey preview was already validated, so a non-null result is guaranteed.
      const citekey = this.computePreviewedCitekey();
      if (!citekey) return;
      const paper: Paper = await this.rv.paperService.createManual(
        {
          title: this.form.title.trim(),
          authors: lastNames,
          authorFirstNames: firstNames,
          year,
          venue: this.form.venue.trim() || undefined,
          doi: this.form.doi.trim() || undefined,
          abstract: this.form.abstract.trim() || undefined,
          // Field renamed in 2.7.1 — `createManual` performs the copy itself;
          // we just hand it the source vault path.
          attachPdfFrom: this.form.pdfPath.trim() || undefined,
          keywords,
          status: this.form.status,
          priority: this.form.priority,
          citekey,
        },
        this.form.projectId,
      );
      const attachNote = this.form.pdfPath.trim() ? ' with attached PDF' : '';
      new Notice(`ResearchVault: imported "${paper.citekey}"${attachNote}.`);
      this.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // PDF file picker helpers
  // -------------------------------------------------------------------------

  /**
   * Walk the vault for `.pdf` files and let the user pick one via a simple
   * prompt. Returns `null` if cancelled or no PDFs found.
   */
  private async pickPdfFromVault(): Promise<TFile | null> {
    const allFiles = this.app.vault.getFiles();
    const pdfs = allFiles.filter((f) => f.extension === 'pdf');

    if (pdfs.length === 0) {
      new Notice('Researchvault: no PDF files found in the vault.');
      return null;
    }

    // Sort alphabetically for easier scanning.
    pdfs.sort((a, b) => a.path.localeCompare(b.path));

    // Use a simple prompt-style picker via an Obsidian Modal with a list.
    const picked = await new Promise<TFile | null>((resolve) => {
      const modal = new PdfPickerModal(this.app, pdfs, resolve);
      modal.open();
    });

    return picked;
  }

  /**
   * Copy a dropped file (from the OS) into the project's `pdfs/` folder and
   * return its vault path. Returns `null` on failure. The destination is the
   * per-project pdfs/ folder (D27) so the note's `## Attached PDF` wikilink
   * resolves to a path that lives next to its paper.
   */
  private async copyPdfIntoVault(file: File): Promise<string | null> {
    const project = this.rv.projectManager.getProjectById(this.form.projectId);
    if (!project) {
      new Notice('Researchvault: pick a project first.');
      return null;
    }

    const pdfsFolder = this.rv.projectManager.getProjectPdfsFolder(project.id);
    // Ensure the target folder exists. `createFolder` throws if the folder is
    // already there, so swallow that case while still surfacing real errors.
    try {
      await this.app.vault.createFolder(pdfsFolder);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/exists/i.test(msg) && !/already/i.test(msg)) {
        new Notice(`ResearchVault: failed to create pdfs folder — ${msg}`);
        return null;
      }
    }

    const safeName = file.name.replace(/\.pdf$/i, '') + '.pdf';
    const targetPath = `${pdfsFolder}/${safeName}`;

    try {
      const arrayBuffer = await file.arrayBuffer();
      await this.app.vault.createBinary(targetPath, arrayBuffer);
      return targetPath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: failed to copy PDF — ${msg}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// PdfPickerModal — simple list picker for vault PDFs
// ---------------------------------------------------------------------------

class PdfPickerModal extends Modal {
  private readonly pdfs: TFile[];
  private resolve!: (value: TFile | null) => void;

  constructor(app: App, pdfs: TFile[], resolve: (value: TFile | null) => void) {
    super(app);
    this.pdfs = pdfs;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('researchvault-pdf-picker');

    contentEl.createEl('h2', { text: 'Pick a PDF to import' });
    contentEl.createEl('p', {
      text: `Found ${this.pdfs.length} PDF${this.pdfs.length === 1 ? '' : 's'} in the vault.`,
      cls: 'setting-item-description',
    });

    const list = contentEl.createDiv({ cls: 'researchvault-pdf-picker-list' });

    for (const pdf of this.pdfs) {
      const row = list.createDiv({ cls: 'researchvault-pdf-picker-row' });
      row.createSpan({ text: pdf.path, cls: 'researchvault-pdf-picker-path' });
      row.addEventListener('click', () => {
        this.resolve(pdf);
        this.close();
      });
    }

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => {
        this.resolve(null);
        this.close();
      }));
  }

  onClose(): void {
    this.contentEl.empty();
    // Ensure we always resolve (in case the user closed via X).
    if (!this.resolved) this.resolve(null);
  }

  private resolved = false;
}



// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 2.8.E — Convert the modal's three comma-separated name fields into
 * parallel `lastNames` + `firstNames` string arrays.
 *
 * - `primary` is the required last name of the first author.
 * - `additional` is comma-separated additional author names.
 * - `firstNamesCsv` is comma-separated first names corresponding (1-to-1)
 *   to entries in `additional`. The first entry corresponds to additional
 *   author index 0 and is paired with the modal's primary last name.
 *
 * When a parallel first name is supplied for an author, it's preferred
 * and we don't auto-split the name. When omitted and an author entry has
 * multiple space-separated tokens, the last token becomes the last name.
 */
function buildAuthorRows(
  primary: string,
  additional: string,
  firstNamesCsv: string,
): { lastNames: string[]; firstNames: string[] } {
  const additionalTokens = additional.split(',').map((t) => t.trim()).filter(Boolean);
  const firstNamesRaw = firstNamesCsv.split(',').map((t) => t.trim());
  // The primary author's first name lives in `firstNamesRaw[0]`. Additional
  // authors consume slots from index 1 onward. Trim all entries up-front so
  // the loop below can simply read by index.
  const namesList = [primary, ...additionalTokens];
  // For each entry, choose the first name:
  //   - primary (index 0): use firstNamesRaw[0] if present, else auto-split.
  //   - additional (index > 0): use firstNamesRaw[i] if present, else auto-split.
  const lastNames: string[] = [];
  const firstNames: string[] = [];
  namesList.forEach((raw, i) => {
    if (!raw) return;
    const explicitFirst = i < firstNamesRaw.length ? (firstNamesRaw[i] ?? '').trim() : '';
    const parts = raw.split(/\s+/).filter(Boolean);
    if (explicitFirst) {
      lastNames.push(parts.join(' ') || raw);
      firstNames.push(explicitFirst);
      return;
    }
    if (parts.length <= 1) {
      lastNames.push(parts[0] ?? raw);
      firstNames.push('');
    } else {
      lastNames.push(parts[parts.length - 1] ?? '');
      firstNames.push(parts.slice(0, -1).join(' '));
    }
  });
  return { lastNames, firstNames };
}
