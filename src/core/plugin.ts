// src/core/plugin.ts
//
// `ResearchVaultPlugin` owns the plugin lifecycle and the long-lived
// singleton services. `main.ts` is reduced to a re-export so this file can
// stay the single source of truth for plugin-wide wiring.
//

import { Plugin, Notice, TFolder } from 'obsidian';
import {
  ResearchVaultSettings,
  migrateSettings,
} from '../settings';
import { ProjectManager } from '../services/project-manager';
import { EventEmitter } from '../utils/event-emitter';
import type { ResearchVaultEvents } from './events';
import { CreateProjectModal, SwitchProjectModal } from '../ui/modals/create-project-modal';
import { ResearchVaultSettingTab } from '../ui/settings/settings-tab';

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
  eventBus!: EventBus;

  /** Pulled out so it can be invoked by `addCommand({ editorCallback })` and the settings tab alike. */
  openCreateProjectModal(): void {
    new CreateProjectModal(this.app, this).open();
  }

  /** Companion to the create modal; lets the user re-target the active project without going through settings. */
  openSwitchProjectModal(): void {
    new SwitchProjectModal(this.app, this).open();
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

    // 4. UI: ribbon + commands + settings tab.
    this.addRibbonIcon('library', 'Open researchvault', () => {
      const active = this.projectManager.getActiveProject();
      if (!active) {
        new Notice('Researchvault: no active project. Open the create project modal from settings → researchvault.');
        return;
      }
      const folder = this.app.vault.getAbstractFileByPath(active.folderPath);
      if (folder instanceof TFolder) {
        // Fire-and-forget: openLinkText returns a promise we don't need to await on a hot button path.
        void this.app.workspace.openLinkText(active.folderPath, '/', false);
      }
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
