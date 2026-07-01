// src/core/plugin.ts
//
// `ResearchVaultPlugin` owns the plugin lifecycle and the long-lived
// singleton services. `main.ts` is reduced to a re-export so this file can
// stay the single source of truth for plugin-wide wiring.
//

import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import {
  ResearchVaultSettings,
  migrateSettings,
} from '../settings';
import { ProjectManager } from '../services/project-manager';
import { PaperService } from '../services/paper-service';
import { EventEmitter } from '../utils/event-emitter';
import type { ResearchVaultEvents } from './events';
import { CreateProjectModal, SwitchProjectModal } from '../ui/modals/create-project-modal';
import { PaperImportModal } from '../ui/modals/paper-import-modal';
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
  eventBus!: EventBus;

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

    // 4. UI: view registration, ribbon, commands, settings tab.
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

    this.addSettingTab(new ResearchVaultSettingTab(this.app, this));

    // 5. Save any defaults we just materialised.
    if (!stored || Object.keys(stored).length === 0) {
      await this.saveData(this.settings);
    }
  }

  onunload(): void {
    this.eventBus?.clear();
  }

  /**
   * Centralised save helper. Services mutate `plugin.settings` and call this
   * so lifecycle matches Obsidian's built-in plugin data store and survives
   * hot-reloads, vault moves, and plugin updates.
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
