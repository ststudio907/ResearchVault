// src/core/plugin.ts
//
// `ResearchVaultPlugin` owns the plugin lifecycle and the long-lived
// singleton services. `main.ts` is reduced to a re-export so this file can
// stay the single source of truth for plugin-wide wiring.
//

import { Plugin, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type { Paper, QuoteSource } from '../types';
import {
  ResearchVaultSettings,
  migrateSettings,
} from '../settings';
import { ProjectManager } from '../services/project-manager';
import { PaperService } from '../services/paper-service';
import { VaultIndexer } from '../services/vault-indexer';
import { CitationService } from '../services/citation/citation-service';
import { ZoteroClient } from '../services/integrations/zotero/zotero-client';
import { ZoteroLocalClient } from '../services/integrations/zotero/zotero-local-client';
import { EventEmitter } from '../utils/event-emitter';
import type { ResearchVaultEvents } from './events';
import { CreateProjectModal, SwitchProjectModal } from '../ui/modals/create-project-modal';
import { PaperImportModal } from '../ui/modals/paper-import-modal';
import { QuoteCaptureModal } from '../ui/modals/quote-capture-modal';
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

  /** Companion to the create modal; lets the user re-target the active project without going through settings. */
  openSwitchProjectModal(): void {
    new SwitchProjectModal(this.app, this).open();
  }

  /** Open the manual paper-import modal. Routes to the active project by default. */
  openAddPaperModal(): void {
    if (this.projectManager.getAllProjects().length === 0) {
      new Notice('Researchvault: create a project before adding a paper.');
      return;
    }
    new PaperImportModal(this.app, this).open();
  }

  /** Open the quote-capture modal. Optionally pre-fill text from an editor selection or target a specific paper. */
  openQuoteCaptureModal(
    options?: { selectedText?: string; defaultPaperId?: string; source?: QuoteSource },
  ): void {
    if (this.projectManager.getAllProjects().length === 0) {
      new Notice('Researchvault: create a project before capturing a quote.');
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
    // Hydrate is async; we don't block plugin load on it so the ribbon and
    // commands are responsive immediately. Hydration emits no events the
    // UI needs to react to before the first user action.
    void this.paperService.hydrate();

    // Indexer is built on top of `paperService`, so it must come after.
    this.vaultIndexer = new VaultIndexer(this);
    this.vaultIndexer.hydrate();

    // 4. Live sync from the vault (D23). We deliberately register these
    // before the view/commands so the very first `paperUpdated` event after
    // `hydrate` is caught by subscribers already in place.
    this.registerVaultSync();

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
      name: 'Switch active project',
      callback: () => this.openSwitchProjectModal(),
    });

    this.addCommand({
      id: 'add-paper',
      name: 'Add paper',
      callback: () => this.openAddPaperModal(),
    });

    this.addCommand({
      id: 'open-sidebar',
      name: 'Open sidebar',
      callback: () => {
        void this.openSidebar();
      },
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
          new Notice('Researchvault: select text in the editor first, then run "capture quote".');
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
          // a write we just performed ourselves (`selfAwareModify` armed the
          // marker), skip external-edit handling entirely. Previously the
          // echo ran `onPaperFileModified` against the still-stale in-memory
          // snapshot, which re-stamped the OLD values back to disk and
          // clobbered in-flight status/priority changes ("changes then
          // reverts right away"). The 2.8.D 2-second guard stays as a
          // second line of defense inside `onPaperFileModified`.
          if (this.paperService.consumeSelfWrite(file.path)) return;
          // 2.8.D — re-stamp `dateModified` on every body-or-frontmatter
          // edit. `syncFromFile` still owns frontmatter-only re-syncs.
          void this.paperService.onPaperFileModified(file);
          void this.paperService.syncFromFile(file);
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
