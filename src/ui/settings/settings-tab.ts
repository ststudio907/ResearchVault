// src/ui/settings/settings-tab.ts
//
// Settings UI for ResearchVault. Built on Obsidian's `PluginSettingTab` so the
// layout and theme follow the host app without us re-inventing the chrome.
// Sections, in order: General → Projects → AI → Templates.
//

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type { ResearchVaultPlugin } from '../../core/plugin';
import { CITATION_STYLES, AI_PROVIDERS } from '../../types';
import { ConfirmModal } from '../modals/confirm-modal';

export class ResearchVaultSettingTab extends PluginSettingTab {
  /** Alias keeps `this.plugin.settings` lines short without a confused `plugin.plugin`. */
  private readonly rv: ResearchVaultPlugin;

  constructor(app: App, plugin: ResearchVaultPlugin) {
    super(app, plugin);
    this.rv = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderGeneral(containerEl);
    this.renderProjects(containerEl);
    this.renderAI(containerEl);
    this.renderTemplates(containerEl);
  }

  // -------------------------------------------------------------------------
  // General
  // -------------------------------------------------------------------------

  private renderGeneral(root: HTMLElement): void {
    ;

    new Setting(root)
      .setName('Default citation style')
      .setDesc('Style applied to new projects unless they override it.')
      .addDropdown((dropdown) => {
        for (const style of CITATION_STYLES) dropdown.addOption(style, style);
        dropdown.setValue(this.rv.settings.globalCitationStyle);
        dropdown.onChange(async (value) => {
          this.rv.settings.globalCitationStyle = value as typeof this.rv.settings.globalCitationStyle;
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Default excluded folders')
      .setDesc('Comma-separated vault paths new projects will skip during indexing.')
      .addText((text) => {
        text.setPlaceholder('Config folder, .trash');
        text.setValue(this.rv.settings.globalExcludedFolders.join(', '));
        text.onChange(async (value) => {
          this.rv.settings.globalExcludedFolders = value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          await this.rv.saveSettings();
        });
      });
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  private renderProjects(root: HTMLElement): void {
    new Setting(root).setName("Projects").setHeading();

    new Setting(root)
      .setName('Create a new project')
      .setDesc('Opens a modal that accepts a name and a vault folder path.')
      .addButton((button) =>
        button.setButtonText('Create project').onClick(() => this.rv.openCreateProjectModal()),
      );

    const projects = this.rv.projectManager.getAllProjects();
    if (projects.length === 0) {
      root.createEl('p', {
        text: 'No projects yet. Create one above to get started.',
        cls: 'setting-item-description',
      });
      return;
    }

    const list = root.createEl('div', { cls: 'rv-project-list' });
    for (const project of projects) {
      const row = new Setting(list)
        .setName(project.name)
        .setDesc(
          [
            project.isActive ? '🟢 Active' : '⚪ Inactive',
            `Folder: ${project.folderPath}`,
            project.description ? `— ${project.description}` : '',
          ]
            .filter(Boolean)
            .join(' '),
        );

      if (!project.isActive) {
        row.addButton((btn) =>
          btn.setButtonText('Activate').onClick(async () => {
            await this.rv.projectManager.activateProject(project.id);
            this.display();
          }),
        );
      }

      row.addButton((btn) =>
        btn
          .setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            const ok = await ConfirmModal.ask(this.app, {
              title: 'Delete project',
              message: `Delete project "${project.name}"?\n\nFiles on disk are untouched.`,
              confirmLabel: 'Delete',
              cancelLabel: 'Cancel',
              destructive: true,
            });
            if (!ok) return;
            await this.rv.projectManager.deleteProject(project.id);
            this.display();
          }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // AI
  // -------------------------------------------------------------------------

  private renderAI(root: HTMLElement): void {
    new Setting(root).setName("AI features").setHeading();

    root.createEl('p', {
      text:
        'AI features send selected text (papers, quotes, or chat input) to the provider you configure below. ' +
        'Features are disabled until both the toggles and an API key (if required) are set.',
      cls: 'setting-item-description',
    });

    new Setting(root)
      .setName('Provider')
      .addDropdown((dropdown) => {
        for (const provider of AI_PROVIDERS) dropdown.addOption(provider, provider);
        dropdown.setValue(this.rv.settings.ai.provider);
        dropdown.onChange(async (value) => {
          this.rv.settings.ai.provider = value as typeof this.rv.settings.ai.provider;
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Model')
      .addText((text) => {
        text.setPlaceholder('Example model name');
        text.setValue(this.rv.settings.ai.model);
        text.onChange(async (value) => {
          this.rv.settings.ai.model = value;
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('API key')
      .setDesc('Stored locally in this plugin settings file. Never sent anywhere except the provider you chose.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('Sk-…');
        text.setValue(this.rv.settings.ai.apiKey ?? '');
        text.onChange(async (value) => {
          this.rv.settings.ai.apiKey = value || undefined;
          await this.rv.saveSettings();
        });
      });

    new Setting(root)
      .setName('Maximum tokens per request')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.rv.settings.ai.maxTokens));
        text.onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            this.rv.settings.ai.maxTokens = n;
            await this.rv.saveSettings();
          }
        });
      });

    new Setting(root)
      .setName('Temperature')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.rv.settings.ai.temperature));
        text.onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0 && n <= 2) {
            this.rv.settings.ai.temperature = n;
            await this.rv.saveSettings();
          }
        });
      });

    new Setting(root).setName("Feature toggles").setHeading();

    const toggles: Array<[keyof typeof this.rv.settings.ai & `enable${string}`, string]> = [
      ['enableSummarization', 'Enable summarization'],
      ['enableChat', 'Enable chat with vault context'],
      ['enableSuggestions', 'Enable suggested connections'],
    ];
    for (const [key, label] of toggles) {
      new Setting(root)
        .setName(label)
        .addToggle((toggle) => {
          toggle.setValue(Boolean(this.rv.settings.ai[key]));
          toggle.onChange(async (value) => {
            // Cast through `unknown` to keep the union narrow at the array level.
            (this.rv.settings.ai as unknown as Record<string, boolean>)[key] = value;
            await this.rv.saveSettings();
          });
        });
    }

    new Setting(root)
      .setName('Clear saved key')
      .setDesc('Wipe the API key from settings without changing other fields.')
      .addButton((btn) =>
        btn.setButtonText('Clear').setWarning().onClick(async () => {
          this.rv.settings.ai.apiKey = undefined;
          await this.rv.saveSettings();
          new Notice('Researchvault: API key cleared.');
          this.display();
        }),
      );
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  private renderTemplates(root: HTMLElement): void {
    new Setting(root).setName("Templates").setHeading();
    root.createEl('p', {
      text: 'Templates are wired into the paper and note flows in sprint 2. Edit them here today so they are ready.',
      cls: 'setting-item-description',
    });

    const templates: Array<[keyof typeof this.rv.settings.templates, string]> = [
      ['paper', 'Paper template'],
      ['note', 'Note template'],
      ['dailyNote', 'Daily note template'],
    ];
    for (const [key, label] of templates) {
      new Setting(root)
        .setName(label)
        .addTextArea((text) => {
          text.setValue(this.rv.settings.templates[key]);
          text.onChange(async (value) => {
            this.rv.settings.templates[key] = value;
            await this.rv.saveSettings();
          });
        });
    }
  }
}
