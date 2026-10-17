// src/core/plugin.ts
//
// `ResearchVaultPlugin` owns the plugin lifecycle and the long-lived
// singleton services. `main.ts` is reduced to a re-export so this file can
// stay the single source of truth for plugin-wide wiring.
//

import { Editor, Plugin, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type { Paper, QuoteSource } from '../types';
import {
  ResearchVaultSettings,
  migrateSettings,
} from '../settings';
import { ProjectManager } from '../services/project-manager';
import { PaperService } from '../services/paper-service';
import { VaultIndexer } from '../services/vault-indexer';
import { BibliographyService } from '../services/citation/bibliography-service';
import { CitationService } from '../services/citation/citation-service';
import { ZoteroClient } from '../services/integrations/zotero/zotero-client';
import { ZoteroLocalClient } from '../services/integrations/zotero/zotero-local-client';
import { EventEmitter } from '../utils/event-emitter';
import type { ResearchVaultEvents } from './events';
import { CreateProjectModal, SwitchProjectModal } from '../ui/modals/create-project-modal';
import { PaperImportModal } from '../ui/modals/paper-import-modal';
import { QuoteCaptureModal } from '../ui/modals/quote-capture-modal';
import { CitationPickModal } from '../ui/modals/citation-pick-modal';
import { registerCitationLinkProcessor } from '../ui/citation-link-renderer';
import { formatCitationMarkup } from '../services/citation/citation-markup';
import { ResearchVaultSettingTab } from '../ui/settings/settings-tab';
import { ProjectsSidebarView, VIEW_TYPE_RESEARCHVAULT_SIDEBAR } from '../ui/views/projects-sidebar-view';

/**
 * Typed wrapper around the raw `Map<eventName, EventEmitter>`. Centralising
 * it here so services and UI consumers share one event vocabulary.
 */
export type EventBus = {
  on<K extends keyof ResearchVaultEvents>(
    event: K,
    listener: (payload: ResearchVaultEvents[K]) => void,
  ): () => void;
  emit<K extends keyof ResearchVaultEvents>(event: K, payload: ResearchVaultEvents[K]): void;
  clear(): void;
};

export class ResearchVaultPlugin extends Plugin {
  settings!: ResearchVaultSettings;
  projectManager!: ProjectManager;
  paperService!: PaperService;
  vaultIndexer!: VaultIndexer;
  /** C1 (3.2 Citation excellence / D36): owns the per-project `bibliography.bib` rebuild. */
  bibliographyService!: BibliographyService;
  eventBus!: EventBus;
  /**
   * 4.1.A: lazily constructed. `onload` does NOT instantiate it — the modal
   * (4.1.C) and the settings tab (4.1.D) call `ensureCitationService()` when
   * the user actually engages. This keeps `onload` cheap for users who never
   * enable the feature, and lets the LRU cache + rate limiter state be tied
   * to the service lifetime rather than the plugin lifetime.
   */
  private citationService: CitationService | null = null;
  /** 5.1 — lazily constructed by `ensureZoteroClient`. */
  private zoteroClient: ZoteroClient | null = null;
  /** 5.2 — lazily constructed by `ensureZoteroLocalClient`. */
  private zoteroLocalClient: ZoteroLocalClient | null = null;

  /** Pulled out so it can be invoked by `addCommand({ editorCallback })` and the settings tab alike. */
  openCreateProjectModal(): void {
    new CreateProjectModal(this.app, this).open();
  }

  /**
   * Project lifecycle hub (activate / create / delete). ID stays
   * `switch-project` for command stability; the modal is titled
   * "Manage projects" (2026-10-17 user-flagged consolidation).
   */
  openSwitchProjectModal(): void {
    new SwitchProjectModal(this.app, this).open();
  }

  /** Open the manual paper-import modal. Routes to the active project by default. */
  openAddPaperModal(): void {
    if (this.projectManager.getAllProjects().length === 0) {
      new Notice('ResearchVault: create a project before adding a paper.');
      return;
    }
    new PaperImportModal(this.app, this).open();
  }

  /**
   * Rebuild `<active project>/bibliography.bib` (3.2 Citation excellence C1).
   * Guards mirror `openAddPaperModal`: no active project / empty library get
   * a Notice and no file on disk. The overwrite-guard-decline path returns
   * quietly — the confirm modal already said its piece.
   */
  async exportActiveBibliography(): Promise<void> {
    const active = this.projectManager.getActiveProject();
    if (!active) {
      new Notice('ResearchVault: activate a project before exporting a bibliography.');
      return;
    }
    if (this.paperService.getInProject(active.id).length === 0) {
      new Notice('ResearchVault: no papers in the active project to export.');
      return;
    }
    try {
      const result = await this.bibliographyService.exportProjectBibliography(active.id);
      if (!result) return; // overwrite guard declined
      new Notice(`ResearchVault: exported ${result.count} entries to ${result.path}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`ResearchVault: bibliography export failed: ${message}`);
    }
  }

  /**
   * Insert `[@citekey]` at the cursor (3.2 Citation excellence C2 / D35).
   * Guards mirror `openAddPaperModal`: no active project / empty library get
   * a Notice and nothing is inserted.
   */
  openInsertCitationModal(editor: Editor): void {
    const active = this.projectManager.getActiveProject();
    if (!active) {
      new Notice('ResearchVault: activate a project before inserting a citation.');
      return;
    }
    const papers = this.paperService.getInProject(active.id);
    if (papers.length === 0) {
      new Notice('ResearchVault: no papers in the active project to cite.');
      return;
    }
    new CitationPickModal(this.app, papers, (paper, form) => {
      editor.replaceRange(formatCitationMarkup(paper.citekey, form), editor.getCursor());
    }).open();
  }

  /** Open the quote-capture modal. Optionally pre-fill text from an editor selection or target a specific paper. */
  openQuoteCaptureModal(
    options?: { selectedText?: string; defaultPaperId?: string; source?: QuoteSource },
  ): void {
    if (this.projectManager.getAllProjects().length === 0) {
      new Notice('ResearchVault: create a project before capturing a quote.');
      return;
    }
    new QuoteCaptureModal(this.app, this, options).open();
  }

  /**
   * Open the paper-import modal in edit mode, pre-populated with the supplied
   * paper's metadata. Used by the sidebar's edit-pencil button so the user
   * can flip priority / status / keywords without leaving the list.
   */
  openEditPaperModal(paper: Paper): void {
    new PaperImportModal(this.app, this, { paperToEdit: paper }).open();
  }

  /**
   * Reveal the projects sidebar in the right rail, creating a leaf on first
   * call. Subsequent calls re-focus the existing leaf so the user can toggle
   * the view without losing their place.
   *
   * `revealLeaf` was added in Obsidian 1.7.2 (we target 1.6.6). For an
   * existing leaf we re-apply its view state with `active: true`, which
   * brings it into focus across the versions we support. The `activeLeaf`
   * field is deprecated, so we avoid it.
   */
  async openSidebar(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_RESEARCHVAULT_SIDEBAR)[0];
    if (existing) {
      await existing.setViewState({ type: VIEW_TYPE_RESEARCHVAULT_SIDEBAR, active: true });
      return;
    }
    const leaf: WorkspaceLeaf = workspace.getRightLeaf(false) ?? workspace.getLeaf('split');
    await leaf.setViewState({ type: VIEW_TYPE_RESEARCHVAULT_SIDEBAR, active: true });
  }

  async onload(): Promise<void> {
    // 1. Settings (load + migrate).
    const stored = (await this.loadData()) as Record<string, unknown> | null;
    this.settings = migrateSettings(stored);

    // 2. Event bus.
    const bus = new Map<keyof ResearchVaultEvents, EventEmitter<unknown>>();
    const ensure = <K extends keyof ResearchVaultEvents>(e: K): EventEmitter<ResearchVaultEvents[K]> => {
      let inner = bus.get(e) as EventEmitter<ResearchVaultEvents[K]> | undefined;
      if (!inner) {
        inner = new EventEmitter<ResearchVaultEvents[K]>();
        bus.set(e, inner as EventEmitter<unknown>);
      }
      return inner;
    };
    this.eventBus = {
      on: (event, listener) => ensure(event).on(listener),
      emit: (event, payload) => ensure(event).emit(payload),
      clear: () => {
        for (const inner of bus.values()) inner.clear();
        bus.clear();
      },
    };

    // 3. Services.
    this.projectManager = new ProjectManager(this);
    this.projectManager.hydrate();

    this.paperService = new PaperService(this, this.projectManager);
    // Trivial constructor (no disk I/O until export), safe to wire up front.
    this.bibliographyService = new BibliographyService(this);

    // Indexer is built on top of `paperService`; the constructor is trivial,
    // so we create the instance up front and hydrate it once papers are
    // loaded (see the layout-ready hook below).
    this.vaultIndexer = new VaultIndexer(this);

    // Hydration waits for the workspace layout so Obsidian's metadata cache
    // is warm and `readPaperFile` can reuse cached frontmatter instead of
    // hitting disk for every note. The indexer hydrate MUST run after
    // `paperService.hydrate()` — previously both were fire-and-forget `void`
    // calls, so the indexer was built against an empty paper store and
    // search returned nothing until the sidebar was manually refreshed.
    // Vault sync comes last: the full scan already covers anything that
    // changed during startup, and early `modify` events from Obsidian's
    // initial vault scan can then no longer interleave with `hydrate`
    // clearing and rebuilding the index.
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        try {
          await this.paperService.hydrate();
        } catch (err) {
          console.error('[ResearchVault] paper hydration failed', err);
        }
        this.vaultIndexer.hydrate();
        this.registerVaultSync();
      })();
    });

    // 5. UI: view registration, ribbon, commands, settings tab.
    this.registerView(
      VIEW_TYPE_RESEARCHVAULT_SIDEBAR,
      (leaf) => new ProjectsSidebarView(leaf, this),
    );

    this.addRibbonIcon('library', 'Open researchvault sidebar', () => {
      // Fire-and-forget: errors surface via the view's own error handling.
      void this.openSidebar();
    });

    this.addCommand({
      id: 'create-project',
      name: 'Create research project',
      callback: () => this.openCreateProjectModal(),
    });

    this.addCommand({
      id: 'switch-project',
      name: 'Manage projects',
      callback: () => this.openSwitchProjectModal(),
    });

    this.addCommand({
      id: 'add-paper',
      name: 'Add paper',
      callback: () => this.openAddPaperModal(),
    });

    this.addCommand({
      id: 'export-bibliography',
      name: 'Export bibliography (BibTeX)',
      callback: () => {
        void this.exportActiveBibliography();
      },
    });

    this.addCommand({
      id: 'open-sidebar',
      name: 'Open sidebar',
      callback: () => {
        void this.openSidebar();
      },
    });

    // 3.2 C2 follow-up: render `[@citekey]` as a clickable link to the paper
    // note in reading view (the markup itself stays inert for Pandoc).
    registerCitationLinkProcessor(this);

    this.addCommand({
      id: 'insert-citation',
      name: 'Insert citation',
      editorCallback: (editor) => this.openInsertCitationModal(editor),
    });

    // Capture quote from editor selection. The `editorCallback` signature lets
    // Obsidian pre-fill the modal with whatever text the user has highlighted,
    // so they can drop a quote without leaving their reading flow.
    this.addCommand({
      id: 'capture-quote',
      name: 'Capture quote',
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) {
          new Notice('ResearchVault: select text in the editor first, then run "capture quote".');
          return;
        }
        this.openQuoteCaptureModal({ selectedText: selection, source: 'editor' });
      },
    });

    this.addSettingTab(new ResearchVaultSettingTab(this.app, this));

    // 5. Save any defaults we just materialised.
    if (!stored || Object.keys(stored).length === 0) {
      await this.saveData(this.settings);
    }
  }

  onunload(): void {
    this.vaultIndexer?.dispose();
    this.paperService?.dispose();
    this.eventBus?.clear();
  }

  /**
   * Subscribe to vault filesystem events so live edits to paper notes
   * propagate without a manual refresh — the sidebar subscribes to `paperUpdated`
   * / `paperRemoved` and re-renders automatically.
   *
   * IMPORTANT: We do NOT trigger a `syncFromFile` on files we ourselves just
   * wrote through `PaperService.updatePaper`/`addQuote` — those flow through
   * `paperImported`/`paperUpdated` and then trigger `vault.on('modify')` once.
   * The idempotent `papersEqual` short-circuit in `syncFromFile` keeps the loop
   * cheap so we don't bother tracking the write source.
   */
  private registerVaultSync(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          // Sidebar-overhaul fix B (2026-09-28): if this event is the echo of
          // a write we just performed ourselves (`selfAwareProcess` armed the
          // marker), skip external-edit handling entirely — `syncFromFile`
          // would only re-read what we already wrote.
          if (this.paperService.consumeSelfWrite(file.path)) return;
          // D24 amended: we no longer re-stamp `dateModified` (it is derived from
          // the file's own mtime). We only schedule a debounced re-sync —
          // Obsidian autosaves while the user types, so one sync per quiet
          // window instead of one write per keystroke-save.
          this.paperService.scheduleSync(file);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        void this.paperService.pathChanged({ oldPath, newPath: file.path });
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        void this.paperService.pathChanged({ oldPath: file.path });
      }),
    );
  }

  /**
   * Centralised save helper. Services mutate `plugin.settings` and call this
   * so lifecycle matches Obsidian's built-in plugin data store and survives
   * hot-reloads, vault moves, and plugin updates.
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * 4.1.A: Lazy getter for the citation orchestrator. The constructor reads
   * `settings.citation` and `eventBus` — both are already initialized by the
   * time the modal calls this method, so we can safely inline the construction.
   *
   * Callers (4.1.C modal, 4.1.D settings tab) can call this on every
   * engagement; the getter is idempotent.
   */
  ensureCitationService(): CitationService {
    if (!this.citationService) {
      this.citationService = new CitationService({
        settings: this.settings,
        eventBus: this.eventBus,
      });
    }
    return this.citationService;
  }

  /**
   * 5.1 — lazy Zotero client accessor, same idempotent pattern as
   * `ensureCitationService`. The client reads `settings.zotero` live via
   * the getter, so settings-tab edits take effect without a reload.
   * Returns `null` when sync is disabled or no userID is configured —
   * callers treat that as "feature unavailable".
   */
  ensureZoteroClient(): ZoteroClient | null {
    if (!this.settings.zotero.enableZoteroSync || !this.settings.zotero.userID.trim()) {
      return null;
    }
    if (!this.zoteroClient) {
      this.zoteroClient = new ZoteroClient(() => this.settings.zotero);
    }
    return this.zoteroClient;
  }

  /** 5.2 — lazy local push-back client (D30 layer b). Loopback-only. */
  ensureZoteroLocalClient(): ZoteroLocalClient | null {
    if (!this.settings.zotero.enableLocalPush) return null;
    if (!this.zoteroLocalClient) {
      this.zoteroLocalClient = new ZoteroLocalClient(() => this.settings.zotero);
    }
    return this.zoteroLocalClient;
  }
}
